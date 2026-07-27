"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blobToWav = blobToWav;
// 把 MediaRecorder 产出的 blob（webm/opus、mp4/aac 等）
// 解码、下混为单声道、重采样到 targetSampleRate，并打包为 WAV。
// 豆包 ASR 接受 16kHz / 16bit / 单声道 WAV。
async function blobToWav(blob, targetSampleRate = 16000) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC)
        throw new Error("当前浏览器不支持 AudioContext");
    const tempCtx = new AC();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();
    // 重采样 + 下混为单声道
    const length = Math.ceil(audioBuffer.duration * targetSampleRate);
    const offline = new OfflineAudioContext(1, length, targetSampleRate);
    const src = offline.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return encodeWav(pcm, targetSampleRate);
}
function encodeWav(pcm, sampleRate) {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample; // mono
    const dataSize = pcm.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeStr(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, "WAVE");
    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // channels = 1
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample
    writeStr(view, 36, "data");
    view.setUint32(40, dataSize, true);
    const base = 44;
    for (let i = 0; i < pcm.length; i++) {
        view.setInt16(base + i * 2, pcm[i], true);
    }
    return new Blob([buffer], { type: "audio/wav" });
}
function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++)
        view.setUint8(offset + i, str.charCodeAt(i));
}
