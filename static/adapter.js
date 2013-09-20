/*global
  mozRTCPeerConnection mozRTCSessionDescription mozRTCIceCandidate
    MediaStream
  webkitRTCPeerConnection webkitMediaStream URL
*/

// Polyfilled items - initialize them to their original names so they don't
// clobber anything implemented at the base name
var RTCPeerConnection = RTCPeerConnection;
var RTCSessionDescription = RTCSessionDescription;
var RTCIceCandidate = RTCIceCandidate;
var getUserMedia = getUserMedia;

// Special adapter routines
var attachMediaStream, reattachMediaStream;

// If getUserMedia is Mozilla-prefixed
if (navigator.mozGetUserMedia) {

  // Adapt to the Mozilla-prefixed names
  RTCPeerConnection = mozRTCPeerConnection;
  RTCSessionDescription = mozRTCSessionDescription;
  RTCIceCandidate = mozRTCIceCandidate;
  getUserMedia = navigator.mozGetUserMedia.bind(navigator);
  
  // Attach media streams using mozSrcObject
  attachMediaStream = function(element, stream) {
    element.mozSrcObject = stream;
    element.play();
  };

  reattachMediaStream = function(to, from) {
    to.mozSrcObject = from.mozSrcObject;
    to.play();
  };

  // Polyfill get{Video,Audio}Tracks with dummy content so they don't
  // break any code that expects them to exist (although the dummy results
  // may still break something).
  MediaStream.prototype.getVideoTracks = MediaStream.prototype.getVideoTracks
    || function() { return []; };

  MediaStream.prototype.getAudioTracks = MediaStream.prototype.getAudioTracks
    || function() { return []; };
  
// If getUserMedia is WebKit-prefixed
} else if (navigator.webkitGetUserMedia) {

  // Adapt to the WebKit-prefixed names (only two of them are prefixed)
  RTCPeerConnection = webkitRTCPeerConnection;
  getUserMedia = navigator.webkitGetUserMedia.bind(navigator);

  // Attach media streams with src + createObjectURL
  // (I'm not sure what circumstances srcObject was ever available, but
  // if it's present, use it instead)
  attachMediaStream = function(element, stream) {
    if (typeof element.srcObject !== 'undefined') {
      element.srcObject = stream;
    } else {
      element.src = URL.createObjectURL(stream);
    }
  };

  reattachMediaStream = function(to, from) {
    to.src = from.src;
  };
}
