
// Generate sdpsample.theOffer
var pc = new RTCPeerConnection({
	iceServers         : [],
	iceTransportPolicy : 'all',
	bundlePolicy       : 'max-bundle',
	rtcpMuxPolicy      : 'require'
});

var offer;
pc.createOffer({
	offerToReceiveAudio : true,
	offerToReceiveVideo : true
}).then(function(o) {
    offer = o;
});

pc.close();


// Generate sdpsample.sendOffer
var pc = new RTCPeerConnection({
	iceServers         : [],
	iceTransportPolicy : 'all',
	bundlePolicy       : 'max-bundle',
	rtcpMuxPolicy      : 'require'
});

var mediaConstraints = { audio: true, video: true};
navigator.mediaDevices.getUserMedia(mediaConstraints).then(function(s) {
    pc.addStream(s);
});

var offer;
pc.createOffer().then(function(o) {
    offer = o;
});

pc.close();
