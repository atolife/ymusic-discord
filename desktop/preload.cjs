const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ymusic', {
  call: (method, data) => ipcRenderer.invoke('ymusic:call', method, data),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('ymusic:state', listener);
    return () => ipcRenderer.removeListener('ymusic:state', listener);
  },
});
