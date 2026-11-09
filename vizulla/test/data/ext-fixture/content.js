document.documentElement.dataset.vzExtension = 'fixture';
chrome.runtime.sendMessage('tabs').then((urls) => { document.documentElement.dataset.vzTabs = String(urls.length); });
