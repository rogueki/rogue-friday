/* global AudioWorkletProcessor, registerProcessor */
class FridayCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor("friday-capture", FridayCapture);
