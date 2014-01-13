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

// The base of the URLs to post the initial offers to.
var chatphraseOffersBase = "/signal/start/";

//phrase: the slugified phrase to connect to.
//cbs: The callbacks to send to the UI/system on various events/hooks.
function chatphraseSignaling (slugPhrase, cbs) {
  cbs = cbs || {};
  var iface = {
    on: cbs
  };

  function xhrPostJson(url, body, opts, cb) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        return cb(rq);
      }
    };
    rq.onerror = function(e){cb(null,e)};
    rq.open("POST", url);
    if (opts.timeout) {
      rq.timeout = opts.timeout;
      rq.ontimeout = opts.ontimeout;
    }
    rq.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    rq.send(JSON.stringify(body));
  }

  function xhrGet(url, opts, cb) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    function handleEnd() {
    }
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        return cb(rq);
      }
    };
    rq.onerror = function(e){cb(null,e)};
    rq.open("GET", url);
    if (opts.timeout) {
      rq.timeout = opts.timeout;
      rq.ontimeout = opts.ontimeout;
    }
    if (opts.ourtag){
      rq.setRequestHeader("If-None-Match", opts.ourtag);
    }
    rq.send();
  }

  // The RTCPeerConnection.
  var pc;
  // The path we GET to listen on / POST updates to.
  var signalPath;
  // Queued ICE candidates to send.
  var localIceQueue = [];
  // Whether we're currently draining the ICE queue
  // (for concurrency control purposes).
  var drainingIceQueue = false;
  // The index of the current message we're asking for.
  var pollPoint = 0;
  // The local stream, for restarting.
  var localStream;

  //stream: the stream object from getUserMedia.
  iface.start = function start(stream) {

    // TODO: destroy existing PeerConnection, if any

    if (stream) localStream = stream;

    // Reinitialize our outside state variables
    signalPath = undefined;
    pollPoint = 0;
    localIceQueue.length = 0;
    drainingIceQueue = false;

    pc = new RTCPeerConnection({
      "iceServers": chatphraseIceServers},

      // DTLS-SRTP is required by the current WebRTC standard.
      // Versions of Chrome before 31 don't do DTLS-SRTP by default
      // (due to an inefficient certificate generation scheme or something),
      // so you need to explicitly request it to be able to interoperate
      // with other implementations (like Firefox).

      // This is less relevant since Chrome 31 went stable in
      // mid-November 2013, but it doesn't hurt anything to keep it around,
      // at least for a while.
      {optional:[{DtlsSrtpKeyAgreement: true}]});

    // Add our stream to the connection
    pc.addStream(localStream);

    // Add a listener for the stream from the other end
    pc.onaddstream = onAddStream;

    // Add our ICE listener
    pc.onicecandidate = onIceCandidate;

    startConnection();
  };

  function startConnection() {
    var endpoint = chatphraseOffersBase + slugPhrase;

    pc.createOffer(postOffer(endpoint), onError, {
      mandatory: {
        OfferToReceiveAudio: true,
        OfferToReceiveVideo: true },
      optional: []});
  }

  function postOffer(endpoint) {
    return function(offer) {
      xhrPostJson(endpoint, offer, {}, handlePostResponse);

      function handlePostResponse(rq, err) {
        // If we're first
        if (rq && rq.status == 202) {
          // keep polling until we get a first offer
          getRemoteDescription(rq.getResponseHeader('Location'), answerOffer);

        // If our offer was created for somebody waiting on it
        } else if (rq && rq.status == 201) {
          // Start using our offer and poll for an answer
          pc.setLocalDescription(offer,
            getRemoteDescription.bind(null,
              rq.getResponseHeader('Location'), pollForIce),
            onError);

        } else handleRqError(rq, err, "posting offer");
      }
    };
  }

  function handleRqError(rq, err, action) {
    // If the request came back with an unexpected status
    if (rq && rq.status) {
      // report it as an error
      return onError(new Error (
        "Got status " + rq.status + " " + (action || "from a request")
        + ": " + rq.responseText));

    // if there was an error in the XHR (no rq or status)
    } else {
      // report it
      return onError(err);
    }
  }

  function handleMessageError(rq, err, action) {
    // if the body is gone (not found, because we don't special-case them)
    if (rq && rq.status == 404) {
      // fire the event for that
      return cbs.remoteSignalLost && cbs.remoteSignalLost();

    // if there was some unexpected status
    } else handleRqError(rq, err, action);
  }

  function getLoop(getF, cb) {
    function checkBody(rq, err) {
      // if a new body isn't yet present, loop
      if (rq && (rq.status == 204 || rq.status == 304)) getF(checkBody);
      else cb(rq, err);
    }
    getF(checkBody);
  }

  function getRemoteDescription(location, next) {
    // Export the path we've just been given for polling on
    // and POSTing updates to
    signalPath = location;

    getLoop(xhrGet.bind(null,location + '/' + pollPoint, {}),
      function(rq, err) {

      if (rq && rq.status == 200) {
        var body;
        try {
          body = JSON.parse(rq.responseText);
          pc.setRemoteDescription(new RTCSessionDescription(body),
            next, onError);
        } catch(e) {
          onError(e);
        }
      } else {
        handleMessageError(rq, err, "polling for remote description");
      }
    });
  }

  function answerOffer(location) {
    return function(){
      pc.createAnswer(setLocalAndPost(location), onError, {
        mandatory: {},
        optional: []});
    };
  }

  function setLocalAndPost(location) {
    return function(desc) {
      pc.setLocalDescription(desc,
        xhrPostJson.bind(null, location, desc, {}, function(rq, err) {
          if (rq && rq.status == 200) pollForIce();
          else handleMessageError(rq, err, "posting answer");
        }), onError);
    };
  }

  function pollForIce() {
    // Unless we've somehow already started sending our queued candidates
    // before this point (if that's even possible)
    if (!drainingIceQueue) {
      // POST any updates we've queued up
      // I'm pretty sure we'll never have any as we're only going to get
      // ICE candidates once we've set our local description, and we only
      // do that in response to a signaling endpoint now, but just in case...
      drainIceQueue();
    }

    function poll(cb) {
      // continue polling
      xhrGet(location + '/' + pollPoint, {}, cb);
    }

    getLoop(poll, respondToPoll);

    // Ignore the "nulLocation" parameter, we never expect to get it.
    function respondToPoll(rq, err) {

      if (rq && rq.status == 200) {
        // Advance the poll position to the next item
        ++pollPoint;

        var body;
        try {
          body = JSON.parse(rq.responseText);
        } catch(e) {
          onError(e);
        }

        // If this is an ICE candidate and not the message saying that the
        // candidates have finished
        if (body) {
          // Add the ICE candidate and continue polling for the next one

          // TODO: Fix this to use callbacks once
          // https://code.google.com/p/webrtc/issues/detail?id=2338
          // is fixed (*shakes fist at Google*)
          pc.addIceCandidate(new RTCIceCandidate(body));
          return getLoop(poll, respondToPoll);

        // If the message was "null", that's our cue to stop polling, we're
        // not going to get any more messages.
        } else {

          // Nonetheless, we're going to keep polling for now, in case we have
          // more ICE candidates to send ourself, or we want to get another
          // message (of course, there's no telling how we'd handle it...)
          return getLoop(poll, respondToPoll);
        }
      } else {
        handleMessageError(rq, err, "polling for ICE candidates");
      }
    }
  }

  function onError(err) {
    return cbs.error && cbs.error(err);
  }

  function onAddStream(evt) {
    return cbs.remoteStream && cbs.remoteStream(evt.stream);
  }

  function drainIceQueue() {
    if (localIceQueue.length > 0) {
      drainingIceQueue = true;
      return xhrPostJson(signalPath, localIceQueue.shift(), {},
        function (rq, err) {
          if (rq && rq.status == 200) {
            return drainIceQueue();
          } else handleMessageError(rq, err, "posting ICE candidate");
        });
    } else {
      drainingIceQueue = false;
      return;
    }
  }

  function sendIceCandidate(candidate) {
    // Add this to the current list of candidates to push
    localIceQueue.push(candidate);

    // If we're ready and not currently sending candidates
    if (signalPath && !drainingIceQueue) {
      // Start sending candidates
      return drainIceQueue();
    }
  }

  function onIceCandidate(evt) {
    return sendIceCandidate(evt.candidate);
  }

  return iface;
}
