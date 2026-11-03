/// <reference types="vite/client" />

/** 詰めた声のデータ（vite.config.ts の voicePack が作る） */
declare module 'virtual:voice-pack' {
  const pack: import('./data/pack.ts').VoicePack;
  export default pack;
}
