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

  function xhrPostJson(url, body, cb, opts) {
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
    // NOTE: the type is text/json and not application/json because I'm
    // too lazy and paranoid to do things right on the server.
    // (It's currently only designed to parse the body when it's a
    // text/ type... eek.)
    // This should be fixed at some point down the line, for instance,
    // once caress is updated with Content-Type saving.
    rq.setRequestHeader("Content-Type", "text/json; charset=utf-8");
    rq.send(JSON.stringify(body));
  }

  function xhrGetJson(url, cb, opts) {
    opts = opts || {};
    var rq = new XMLHttpRequest();
    function handleEnd() {
    }
    rq.onreadystatechange = function () {
      if (rq.readyState == 4) {
        var body;
        try {
          body = JSON.parse(rq.responseText);
        } catch(e) {
          body = rq.responseText;
        }
        return cb(rq.status, body,
          rq.getResponseHeader('Location'), rq.getResponseHeader('Etag'));
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
  // The index of the current message we're asking for.
  var pollPoint = 0;
  // The local stream, for restarting.
  var localStream;

  //stream: the stream object from getUserMedia.
  iface.start = function start(stream) {

    if (stream) localStream = stream;

    // Re-initialize our outside state variables
    signalPath = undefined;

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

    getOffer();
  };

  function getOffer() {
    var endpoint = chatphraseOffersBase + slugPhrase;

    xhrGetJson(endpoint, beginConnection);

    function beginConnection(status,body,location) {
      if (status == 200) {

        // mark that we've got the initial content, and will want to start
        // asking for ICE messages
        ++pollPoint;

        // Set the remote offer and move on to answer it back
        pc.setRemoteDescription(new RTCSessionDescription(body),
          answerOffer(location), onError);
      // If there's no current offer
      } else if (status == 404) {
        // Create the offer
        pc.createOffer(setLocalAndPost(endpoint), onError, {
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
    return function(){
      pc.createAnswer(setLocalAndPost(location), onError, {
        mandatory: {},
        optional: []});
    };
  }

  function setLocalAndPost(location) {
    return function(desc) {
      pc.setLocalDescription(desc, function(){
        xhrPostJson(location, desc, continueFromPost, onError);
      }, onError);
    };
  }

  function continueFromPost(status, body, location) {

    function poll() {
      // continue polling
      xhrGetJson(location + '/' + pollPoint + '?side=down', respondToPoll);
    }

    // Ignore the "nulLocation" parameter, we never expect to get it.
    function respondToPoll(status, body, nulLocation, etag) {

      //if there's no change or no body yet
      if (status == 204 || status == 304) {
        //continue polling
        poll();

      // if there's a new body
      } else if (status == 200) {
        // If we've been awaiting the initial remote description
        if (pollPoint == 0) {
          // update our peerconnection with the new remote description,
          // then continue polling
          ++pollPoint;
          return pc.setRemoteDescription(new RTCSessionDescription(body),
            poll, onError);
        // If we're waiting for ICE candidate updates
        } else {
          // Add remote ICE candidate
          ++pollPoint;
          // TODO: Fix this to use callbacks once
          // https://code.google.com/p/webrtc/issues/detail?id=2338
          // is fixed (*shakes fist at Google*)
          pc.addIceCandidate(new RTCIceCandidate(body));
          return poll();
        }

      // if the body is gone (not found, because we don't special-case them)
      } else if (status == 404) {
        // fire the event for that
        return cbs.remoteSignalLost && cbs.remoteSignalLost();

      // if there was some unexpected status
      } else if (status) {
        // report it as an error
        return onError(new Error (
          "Got status " + status + " while polling " + location
            + ": " + body));

      // if there was an error in the XHR (no status)
      } else {
        // report it
        return onError(body);
      }
    }

    // If the signal endpoint was created
    if (status == 201) {
      // Export the path we've just been given for POSTing updates to
      signalPath = location;
      // Start polling
      return poll();

    // If we're colliding or the endpoint is missing
    // (the endpoint goes missing when someone else answers an offer first)
    } else if (status == 303 || status == 404) {
      // Re-get the offer
      return getOffer();

    } else if (status) {
      return onError(new Error (
        "Got status " + status + " posting session: " + body));

    } else {
      return onError(body);
    }

  }

  function onError(err) {
    return cbs.error && cbs.error(err);
  }

  function onAddStream(evt) {
    return cbs.remoteStream && cbs.remoteStream(evt.stream);
  }

  function onIceCandidate(evt) {
    //if the server is ready to receive our updates
    if (signalPath) {
      // Update our session description with the new ICE candidates
      xhrPostJson(signalPath+'?side=up', evt.candidate,
        function (status,body) {
          if (!status) {
            onError(body);
          } else if (status >= 500) {
            onError(new Error(
              'Got status ' + status + ' updating SDP: ' + body));
          }
        });
    }
  }

  return iface;
}