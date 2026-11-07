// Actuator (P5-BRW-03, DD-11). Observes through accessibility-tree snapshots and
// acts with trusted input events at a node's bounds (via the DevTools protocol,
// the same input path as a real mouse/keyboard). No script is injected into
// pages to act. Every action names a node from the LATEST snapshot.
import type { WebContents } from 'electron';

export interface AxNodeView {
  nodeId: number;
  backendId: number;
  role: string;
  name: string;
  value: string;
  isCommit: boolean;
  isPassword: boolean;
  disabled: boolean;
  options?: string[];
}

export interface Snapshot {
  id: number;
  url: string;
  origin: string;
  title: string;
  nodes: AxNodeView[];
  /** Visible text (untrusted), for the detector and the planner. */
  text: string;
}

const ACTIONABLE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'option', 'spinbutton', 'listbox', 'switch', 'tab', 'PopUpButton', 'textField']);
const COMMIT_WORDS = /\b(submit|pay|buy|purchase|book( now)?|reserve|confirm|order|place order|checkout|send|sign up|subscribe|apply|transfer|donate|réserver|payer|envoyer|commander|confirmer|ohereza|lipa|tuma)\b/i;

let snapshotCounter = 0;

export class Actuator {
  private attached = false;
  private latest: Snapshot | null = null;

  constructor(private readonly wc: WebContents) {}

  get snapshot(): Snapshot | null {
    return this.latest;
  }

  private async cdp<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.attached) {
      if (!this.wc.debugger.isAttached()) this.wc.debugger.attach('1.3');
      this.attached = true;
      await this.wc.debugger.sendCommand('Accessibility.enable');
      await this.wc.debugger.sendCommand('DOM.enable');
    }
    return this.wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  async observe(): Promise<Snapshot> {
    const { nodes } = await this.cdp<{ nodes: any[] }>('Accessibility.getFullAXTree');
    const out: AxNodeView[] = [];
    const texts: string[] = [];
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = n.role?.value ?? '';
      const name = String(n.name?.value ?? '').trim();
      if (role === 'StaticText' && name) texts.push(name);
      if (!ACTIONABLE.has(role) || n.backendDOMNodeId === undefined) continue;
      const props = Object.fromEntries((n.properties ?? []).map((p: any) => [p.name, p.value?.value]));
      out.push({
        nodeId: out.length + 1,
        backendId: n.backendDOMNodeId,
        role,
        name: name.slice(0, 200),
        value: String(n.value?.value ?? '').slice(0, 200),
        isCommit: false,
        isPassword: false,
        disabled: props.disabled === true,
      });
    }
    // DOM facts the AX tree doesn't carry: submit buttons, password fields, select options.
    for (const node of out) {
      try {
        const { node: d } = await this.cdp<{ node: { nodeName: string; attributes?: string[] } }>('DOM.describeNode', { backendNodeId: node.backendId });
        const attrs: Record<string, string> = {};
        for (let i = 0; i < (d.attributes?.length ?? 0); i += 2) attrs[d.attributes![i]!.toLowerCase()] = d.attributes![i + 1]!;
        const tag = d.nodeName.toLowerCase();
        node.isPassword = tag === 'input' && attrs.type?.toLowerCase() === 'password';
        const submitButton = tag === 'button' && (attrs.type ?? 'submit').toLowerCase() === 'submit' && (await this.inForm(node.backendId));
        const submitInput = tag === 'input' && ['submit', 'image'].includes(attrs.type?.toLowerCase() ?? '');
        node.isCommit = submitButton || submitInput || (['button', 'link'].includes(node.role) && COMMIT_WORDS.test(node.name));
        if (tag === 'select') node.options = await this.selectOptions(node.backendId);
      } catch {
        /* node vanished */
      }
    }
    const url = this.wc.getURL();
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      /* about:blank */
    }
    this.latest = { id: ++snapshotCounter, url, origin, title: this.wc.getTitle(), nodes: out.slice(0, 300), text: texts.join(' ').slice(0, 20000) };
    return this.latest;
  }

  private async resolve(backendId: number): Promise<string> {
    const { object } = await this.cdp<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId: backendId });
    return object.objectId;
  }

  private async inForm(backendId: number): Promise<boolean> {
    const objectId = await this.resolve(backendId);
    const r = await this.cdp<{ result: { value: boolean } }>('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ return !!this.form; }', returnByValue: true });
    return r.result.value;
  }

  private async selectOptions(backendId: number): Promise<string[]> {
    const objectId = await this.resolve(backendId);
    const r = await this.cdp<{ result: { value: string[] } }>('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ return [...this.options].map(o => o.text).slice(0, 50); }', returnByValue: true });
    return r.result.value;
  }

  private node(snapshotId: number, nodeId: number): AxNodeView {
    if (!this.latest || this.latest.id !== snapshotId) throw new Error('stale snapshot: observe again');
    const n = this.latest.nodes.find((x) => x.nodeId === nodeId);
    if (!n) throw new Error('unknown node');
    return n;
  }

  /** Browser-drawn highlight of the target (agent overlay, P5-BRW-04). */
  async highlight(snapshotId: number, nodeId: number): Promise<void> {
    const n = this.node(snapshotId, nodeId);
    await this.cdp('Overlay.enable').catch(() => undefined);
    await this.cdp('Overlay.highlightNode', { backendNodeId: n.backendId, highlightConfig: { borderColor: { r: 99, g: 102, b: 241, a: 1 }, contentColor: { r: 99, g: 102, b: 241, a: 0.15 } } }).catch(() => undefined);
  }

  async clearHighlight(): Promise<void> {
    await this.cdp('Overlay.hideHighlight').catch(() => undefined);
  }

  /** Trusted click at the centre of the node's box. */
  async click(snapshotId: number, nodeId: number): Promise<void> {
    const n = this.node(snapshotId, nodeId);
    await this.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId: n.backendId });
    const { model } = await this.cdp<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId: n.backendId });
    const q = model.content;
    const x = (q[0]! + q[2]! + q[4]! + q[6]!) / 4;
    const y = (q[1]! + q[3]! + q[5]! + q[7]!) / 4;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  /** Focus, clear, then insert text through the input pipeline (trusted). */
  async type(snapshotId: number, nodeId: number, text: string): Promise<void> {
    const n = this.node(snapshotId, nodeId);
    await this.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId: n.backendId });
    await this.cdp('DOM.focus', { backendNodeId: n.backendId });
    const objectId = await this.resolve(n.backendId);
    await this.cdp('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ if ("value" in this) { this.select && this.select(); } }' });
    await this.cdp('Input.insertText', { text });
  }

  async select(snapshotId: number, nodeId: number, option: string): Promise<void> {
    const n = this.node(snapshotId, nodeId);
    const objectId = await this.resolve(n.backendId);
    await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function(v){ const o = [...this.options].find(o => o.text.trim().toLowerCase() === v.toLowerCase() || o.value === v); if (o) { this.value = o.value; this.dispatchEvent(new Event("input", {bubbles:true})); this.dispatchEvent(new Event("change", {bubbles:true})); } return !!o; }',
      arguments: [{ value: option }],
    });
  }

  async scroll(dy: number): Promise<void> {
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: dy });
  }

  /** The form fields a commit would send, for the confirmation dialog (AGT-04). */
  async pendingFormValues(snapshotId: number, nodeId: number): Promise<{ action: string; method: string; fields: { name: string; value: string }[] }> {
    const n = this.node(snapshotId, nodeId);
    const objectId = await this.resolve(n.backendId);
    const r = await this.cdp<{ result: { value: { action: string; method: string; fields: { name: string; value: string }[] } } }>('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function(){ const f = this.form || this.closest('form'); if (!f) return { action: location.href, method: 'GET', fields: [] };
        return { action: f.action || location.href, method: (f.method || 'GET').toUpperCase(),
          fields: [...new FormData(f)].map(([k, v]) => ({ name: String(k).slice(0, 80), value: String(v).slice(0, 200) })) }; }`,
    });
    return r.result.value;
  }

  detach(): void {
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach();
    } catch {
      /* gone */
    }
    this.attached = false;
  }
}
