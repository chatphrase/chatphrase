//from adapter.js
/*global RTCPeerConnection getUserMedia attachMediaStream
  reattachMediaStream webrtcDetectedBrowser webrtcDetectedVersion
  RTCSessionDescription RTCIceCandidate*/

"use strict";

var chatphraseIceServers = [
  {"url": "stun:stun.vline.com"}
  ,{"url": "stun:stun.l.google.com:19302"}
  ,{
      url: 'turn:numb.viagenie.ca',
      username: 'ice@chatphrase.com',
      credential: 'yovipletskickit'
  }
];

// The base of the URLs to check the initial offers from.
var chatphraseOffersBase = "/signal/offers/";

//phrase: the slugified phrase to connect to.
//cbs: The callbacks to send to the UI/system on various events/hooks.
function chatphraseSignaling (slugPhrase, cbs) {
  cbs = cbs || {};
  var iface = {
    on: cbs
  };

  function xhrPostSdp(url, body, cb, opts) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        return cb(rq.status, rq.responseText,
          rq.getResponseHeader('Location'));
      }
    };
    rq.onerror = function(e){cb(null,e)};
    rq.open("POST", url);
    if (opts.timeout) {
      rq.timeout = opts.timeout;
      rq.ontimeout = opts.ontimeout;
    }
    rq.setRequestHeader("Content-Type", "text/sdp; charset=utf-8");
    rq.send(body);
  }

  function xhrPutSdp(url, body, cb, opts) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        return cb(rq.status, rq.responseText,
          // PUTs shouldn't really involve Location headers, but
          rq.getResponseHeader('Location'));
      }
    };
    rq.onerror = function(e){cb(null,e)};
    rq.open("PUT", url);
    if (opts.timeout) {
      rq.timeout = opts.timeout;
      rq.ontimeout = opts.ontimeout;
    }
    rq.setRequestHeader("Content-Type", "text/sdp; charset=utf-8");
    rq.send(body);
  }

  // The etag of the latest SDP we've received.
  var ourtag;

  //This isn't STRICTLY SDP-specific, but I'm keeping the name for symmetry.
  function xhrGetSdp(url, cb, opts) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        return cb(rq.status,rq.responseText,
          rq.getResponseHeader('Location'), rq.getResponseHeader('Etag'));
      }
    };
    rq.onerror = function(e){cb(null,e)};
    rq.open("GET", url);
    if (opts.timeout) {
      rq.timeout = opts.timeout;
      rq.ontimeout = opts.ontimeout;
    }
    rq.setRequestHeader("Content-Type", "text/sdp; charset=utf-8");
    if (opts.ourtag){
      rq.setRequestHeader("If-None-Match", opts.ourtag);
    }
    rq.send();
  }

  // The RTCPeerConnection.
  var pc;
  // The path we GET to listen on / PUT updates to.
  var signalPath;
  // The local stream, for restarting.
  var localStream;

  //stream: the stream object from getUserMedia.
  iface.start = function start(stream) {

    if (stream) localStream = stream;

    // Re-initialize our outside state variables
    ourtag = undefined;
    signalPath = undefined;

    pc = new RTCPeerConnection({
      "iceServers": chatphraseIceServers},

      // DTLS-SRTP is required by the current WebRTC standard.
      // Versions of Chrome before 31 don't do DTLS-SRTP by default
      // (due to an inefficient certificate generation scheme or something),
      // so you need to explicitly request it to be able to interoperate
      // with other implementations (like Firefox).
      {optional:[{DtlsSrtpKeyAgreement: true}]});

    // Add our stream to the connection
    pc.addStream(localStream);

    // Add a listener for the stream from the other end
    pc.onaddstream = onAddStream;

    // Add our ICE listener
    pc.onicecandidate = onIceCandidate;

    getOffer();
  };

  function getOffer() {
    var endpoint = chatphraseOffersBase + slugPhrase;

    xhrGetSdp(endpoint, beginConnection);

    function beginConnection(status,body,location) {
      if (status == 200) {
        pc.setRemoteDescription(new RTCSessionDescription({sdp: body,
          type: "offer"}), answerOffer, onError);
      // If there's no current offer
      } else if (status == 404) {
        // Create the offer
        pc.createOffer(setLocalAndPost(location), onError, {
          mandatory: {
            OfferToReceiveAudio: true,
            OfferToReceiveVideo: true },
          optional: []});
      } else if(status) {
        onError(new Error(
          "Got status "+status+" from "+endpoint+": "+body));
      } else {
        onError(body);
      }
    }
  }

  function answerOffer(location) {
    pc.createAnswer(setLocalAndPost(location), onError, {
      mandatory: {},
      optional: []});
  }

  function setLocalAndPost(location) {
    return function(desc) {
      pc.setLocalDescription(desc, function(){
        xhrPostSdp(location, desc.sdp, continueFromPost(location),
          onError);
      }, onError);
    };
  }

  function continueFromPost(location) {
    // Ignore the "nulLocation" parameter, we never expect to get it.
    function poller(status, body, nulLocation, etag){
      if (status == 204 || status == 304) {
        // no change, continue polling
        xhrGetSdp(location, poller, {ourtag: ourtag});
      } else if (status == 200) {
        pc.setRemoteDescription(new RTCSessionDescription({sdp: body,
          type: pc.remoteDescription ? pc.remoteDescription.type : "answer"}));
        ourtag = etag;
      } else if (status == 404) {
        cbs.remoteSignalLost && cbs.remoteSignalLost();
      } else if (status) {
        onError(new Error (
          "Recieved status " + status + " while polling " + location
            + ": " + body));
      } else {
        onError(body);
      }
    }
    xhrGetSdp(location, poller, {ourtag: ourtag});
  }

  function onError(err) {
    cbs.error && cbs.error(err);
  }

  function onAddStream(evt) {
    cbs.remoteStream && cbs.remoteStream(evt.stream);
  }

  function onIceCandidate(candidate) {
    //if the server is ready to receive our updates
    if (signalPath) {
      // Update our session description with the new ICE candidates
      xhrPutSdp(signalPath, pc.localDescription.sdp, function (status,body) {
        if (!status) {
          onError(body);
        } else if (status <= 500) {
          onError(new Error(
            'Received status ' + status + ' updating SDP: ' + body));
        }
      });
    }
  }

  return iface;
}