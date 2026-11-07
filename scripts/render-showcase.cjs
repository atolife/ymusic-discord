// Renders the real desktop UI with fictional data. No token, network or audio capture.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), assets = path.join(root,'docs/assets');
app.disableHardwareAcceleration();
fs.mkdirSync(path.join(root,'.cache/showcase'), {recursive:true});
app.setPath('userData', path.join(root,'.cache/showcase'));
const cover = `data:image/svg+xml;base64,${fs.readFileSync(path.join(assets,'demo-cover.svg')).toString('base64')}`;
const state = { phase:'online',message:'Трансляция активна',channelId:'111111111111111111',channelName:'Voice 01',guildId:'222222222222222222',guildName:'Тестовый сервер',
  botName:'YMusic',level:.63,commandsReady:true,logs:[],mediaSources:[{id:'ru.yandex.desktop.music',name:'Яндекс Музыка'}],
  nowPlaying:{sourceId:'ru.yandex.desktop.music',title:'Night Drive',artist:'YMusic Demo',album:'After Hours',playback:'Playing',positionMs:84000,durationMs:221000,rate:1,sampledAt:Date.now(),updatedAt:Date.now(),cover:{mime:'image/svg+xml',data:fs.readFileSync(path.join(assets,'demo-cover.svg')).toString('base64')}} };
const settings = {hasToken:true,voiceChannelId:state.channelId,guildId:state.guildId,audioDevice:'CABLE Output (VB-Audio Virtual Cable)',captureMode:'process',applicationPath:'',nowPlayingEnabled:true,mediaSourceId:'',autoStart:false,autoConnect:false,djRoleId:''};
ipcMain.handle('ymusic:call', async (_event,method) => {
  if(method==='init') return {ok:true,value:{settings,state,packaged:true,version:'2.2.1'}};
  if(method==='applications') return {ok:true,value:{supported:true,build:26200,applications:[{path:'C:\\Program Files\\YandexMusic\\Яндекс Музыка.exe',name:'Яндекс Музыка'}]}};
  if(method==='devices') return {ok:true,value:[settings.audioDevice]};
  if(method==='catalogue') return {ok:true,value:{guilds:[{id:state.guildId,name:state.guildName}],guildId:state.guildId,channels:[{id:state.channelId,name:state.channelName}],roles:[]}};
  return {ok:true,value:null};
});
app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:1160,height:1100,show:false,backgroundColor:'#101511',webPreferences:{preload:path.join(root,'desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  for(const name of ['hero','social-preview','workflow','discord-icon','discord-banner']){
    const svg=fs.readFileSync(path.join(assets,`${name}.svg`),'utf8');
    const dimensions={hero:[1600,720],'social-preview':[1280,640],workflow:[1600,265],'discord-icon':[1024,1024],'discord-banner':[680,240]}[name];
    window.setContentSize(...dimensions);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:#101511">${svg}</body></html>`)}`);
    await new Promise(resolve=>setTimeout(resolve,650));
    fs.writeFileSync(path.join(assets,`${name}.png`),(await window.webContents.capturePage()).toPNG());
  }
  window.setContentSize(1160,1150);
  await window.loadFile(path.join(root,'desktop/index.html'));
  await new Promise(resolve=>setTimeout(resolve,500));
  const height=await window.webContents.executeJavaScript('document.documentElement.scrollHeight');
  window.setContentSize(1160,Math.min(height+2,1600));
  await new Promise(resolve=>setTimeout(resolve,150));
  fs.writeFileSync(path.join(assets,'app-preview.png'),(await window.webContents.capturePage()).toPNG());
  console.log('Rendered hero, social preview, workflow and fictional UI screenshot.');
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
