// マイクの一覧（listen.ts の listMics）: 端末の設定の物（default・communications）を除き、同じ物は 1 つに。名前が見えない時（許可の前）は空。
import { afterEach, describe, expect, it, vi } from 'vitest';

const dev = (deviceId: string, label: string, kind = 'audioinput') => ({ deviceId, label, kind, groupId: '' });
async function withDevices(list: ReturnType<typeof dev>[]) {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => list, getUserMedia: async () => ({ getTracks: () => [] }) } });
  vi.resetModules();
  return import('../src/voice/listen.ts');
}
afterEach(() => vi.unstubAllGlobals());

describe('マイクの一覧', () => {
  it('lists the microphones by name, without the device default ones and the cameras', async () => {
    const { listMics } = await withDevices([dev('default', '既定 - 内蔵マイク'), dev('communications', '通信 - 内蔵マイク'), dev('a1', '内蔵マイク'), dev('b2', 'USB マイク'), dev('b2', 'USB マイク'), dev('v1', 'カメラ', 'videoinput')]);
    expect(await listMics()).toEqual([
      { id: 'a1', label: '内蔵マイク' },
      { id: 'b2', label: 'USB マイク' },
    ]);
  });
  it('gives nothing before the microphone is allowed (no names)', async () => {
    const { listMics } = await withDevices([dev('', ''), dev('', '')]);
    expect(await listMics()).toEqual([]);
  });
});
