// 再生中の動画（収集の拡張機能）の音を、そのまま 2048 サンプルずつ渡すだけの AudioWorklet。
// サイトの src/voice/capture.worklet.js と同じだが、かたまりの終わりの時刻（AudioContext の時計、秒）も一緒に渡す:
// ページが測っている間に届いたかたまりは、まとめて遅れて読まれるので、その時の再生位置ではなく、この時刻で並べる。
// 音を変えず、出力は無音。「stop」を受けたら、それきり動かない。
class VoiceMatchCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.on = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.on = false;
    };
  }

  process(inputs) {
    if (!this.on) return false;
    const input = inputs[0];
    if (input && input.length) {
      const len = input[0].length;
      // いくつかのチャンネルは、平均して 1 つにする
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (let c = 0; c < input.length; c++) v += input[c][i];
        this.buf[this.n++] = v / input.length;
        if (this.n === this.buf.length) {
          this.port.postMessage({ pcm: this.buf, end: (currentFrame + i + 1) / sampleRate }, [this.buf.buffer]);
          this.buf = new Float32Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('voice-match-capture', VoiceMatchCapture);
