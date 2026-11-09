chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'vz-fixture', title: 'Vizulla fixture action', contexts: ['page'] });
});
chrome.action.setBadgeText({ text: 'OK' });
chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === 'tabs') chrome.tabs.query({}).then((tabs) => reply(tabs.map((t) => t.url)));
  return true;
});
