'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('zeroDesktop', Object.freeze({
  fetchPopulation: () => ipcRenderer.invoke('zero:population'),
  fetchSpaceWeather: () => ipcRenderer.invoke('zero:space-weather'),
  getDesktopState: () => ipcRenderer.invoke('zero:state'),
  setPinned: enabled => ipcRenderer.invoke('zero:pin', enabled),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('zero:startup', enabled),
  onState: callback => subscribe('zero:state-changed', callback),
  onAction: callback => subscribe('zero:action', callback),
  updateTimer: timer => ipcRenderer.send('zero:timer', timer),
  resize: size => ipcRenderer.invoke('zero:resize', size),
  dock: () => ipcRenderer.invoke('zero:dock'),
  close: () => ipcRenderer.invoke('zero:close'),
  quit: () => ipcRenderer.invoke('zero:quit'),
  notify: title => ipcRenderer.invoke('zero:notify', title)
}));
