const transform = require('sdp-transform');
const utils = require('./utils');
const ortc = require('./ortc');
const sdputils = require('./sdputils');
const sdpsample = require('./sdpsample');
const planBUtils = require('./planBUtils');

const mediaCodecs =
[
  {
    kind        : "audio",
    name        : "opus",
    clockRate   : 48000,
    channels    : 2,
    parameters  :
    {
      useinbandfec : 1
    }
  },
  {
    kind      : "video",
    name      : "VP8",
    clockRate : 90000
  },
  {
    kind       : "video",
    name       : "H264",
    clockRate  : 90000,
    parameters :
    {
      "packetization-mode"      : 1,
      "profile-level-id"        : "42e01f",
      "level-asymmetry-allowed" : 1
    }
  }
];

const roomCap = ortc.generateRoomRtpCapabilities(mediaCodecs);
console.log("Room RtpCapabilities");
console.log(JSON.stringify(roomCap));
console.log(" ");


const sdpObj = transform.parse(sdpsample.theOffer);
console.log("Client SDP Object");
console.log(JSON.stringify(sdpObj));
console.log(" ");

const rtpCap = sdputils.extractRtpCapabilities(sdpObj);
console.log("Client RtpCapabilities");
console.log(JSON.stringify(rtpCap));
console.log(" ");

const extendedRtpCap = ortc.getExtendedRtpCapabilities(rtpCap, roomCap);
console.log("Extended RtpCapabilities");
console.log(JSON.stringify(extendedRtpCap));
console.log(" ");


// server.peer.rtpCapabilities
const effectiveRtpCap = ortc.getRtpCapabilities(extendedRtpCap);
console.log("Effective RtpCapabilities");
console.log(JSON.stringify(effectiveRtpCap));
console.log(" ");


const sendRtpParamTmpl =
{
  audio : ortc.getSendingRtpParameters('audio', extendedRtpCap),
  video : ortc.getSendingRtpParameters('video', extendedRtpCap)
};
console.log("Sending RtpParameters Template");
console.log(JSON.stringify(sendRtpParamTmpl.audio));
console.log(JSON.stringify(sendRtpParamTmpl.video));
console.log(" ");


const recvRtpParamTmpl =
{
  audio : ortc.getReceivingFullRtpParameters('audio', extendedRtpCap),
  video : ortc.getReceivingFullRtpParameters('video', extendedRtpCap)
};
console.log("Receiving RtpParameters Template (Full)");
console.log(JSON.stringify(recvRtpParamTmpl.audio));
console.log(JSON.stringify(recvRtpParamTmpl.video));
console.log(" ");


// server.createProducer.rtpParameters
const sendSdpObj = transform.parse(sdpsample.sendOffer);

const audioRtpParam = utils.cloneObject(sendRtpParamTmpl.audio);
planBUtils.fillRtpParametersForTrack(audioRtpParam, sendSdpObj,
  {kind: "audio", id: "5e1af164-d466-4ab6-8b91-41265a513d84"});

const videoRtpParam = utils.cloneObject(sendRtpParamTmpl.video);
planBUtils.fillRtpParametersForTrack(videoRtpParam, sendSdpObj,
  {kind: "video", id: "79c277b1-d3a1-4767-9c9e-bd99026b8478"});

console.log("Sending RtpParameters");
console.log(JSON.stringify(audioRtpParam));
console.log(JSON.stringify(videoRtpParam));
console.log(" ");


const audioRtpMapping = ortc.getProducerRtpParametersMapping(audioRtpParam, roomCap);
const audioConsumableRtpParam = ortc.getConsumableRtpParameters(audioRtpParam, roomCap, audioRtpMapping);
const audioRtpMapping2 =
      {
        codecPayloadTypes  : Array.from(audioRtpMapping.mapCodecPayloadTypes),
        headerExtensionIds : Array.from(audioRtpMapping.mapHeaderExtensionIds)
      };

const videoRtpMapping = ortc.getProducerRtpParametersMapping(videoRtpParam, roomCap);
const videoConsumableRtpParam = ortc.getConsumableRtpParameters(videoRtpParam, roomCap, videoRtpMapping);
const videoRtpMapping2 =
      {
        codecPayloadTypes  : Array.from(videoRtpMapping.mapCodecPayloadTypes),
        headerExtensionIds : Array.from(videoRtpMapping.mapHeaderExtensionIds)
      };

console.log("Producer RtpMapping");
console.log(JSON.stringify(audioRtpMapping2));
console.log(JSON.stringify(videoRtpMapping2));
console.log(" ");

console.log("Consumable RtpParameters");
console.log(JSON.stringify(audioConsumableRtpParam));
console.log(JSON.stringify(videoConsumableRtpParam));
console.log(" ");


const audioConsumerRtpParam = ortc.getConsumerRtpParameters(audioConsumableRtpParam, effectiveRtpCap);
const videoConsumerRtpParam = ortc.getConsumerRtpParameters(videoConsumableRtpParam, effectiveRtpCap);

console.log("Consumer RtpParameters");
console.log(JSON.stringify(audioConsumerRtpParam));
console.log(JSON.stringify(videoConsumerRtpParam));
console.log(" ");

