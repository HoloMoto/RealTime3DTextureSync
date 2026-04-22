(function () {
  const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

  function randomRoomId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function parsePayload(message) {
    try {
      return JSON.parse(message.toString());
    } catch {
      return null;
    }
  }

  const statusEl = document.getElementById('status');
  const qrWrap = document.getElementById('qr-wrap');
  const roomEl = document.getElementById('room-id');

  const roomId = randomRoomId();
  var phonePage =
    window.WEBTEX_PHONE_PAGE && String(window.WEBTEX_PHONE_PAGE).trim().length
      ? String(window.WEBTEX_PHONE_PAGE).trim()
      : new URL('phone.html', window.location.href).href;
  var phoneBase = new URL(phonePage, window.location.href);
  phoneBase.searchParams.set('room', roomId);
  var phoneUrl = phoneBase.toString();

  roomEl.textContent = roomId;

  try {
    qrWrap.innerHTML = '';
    new QRCode(qrWrap, {
      text: phoneUrl,
      width: 220,
      height: 220,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H,
    });
  } catch (err) {
    statusEl.textContent = 'QRの生成に失敗しました';
    console.error(err);
  }

  const linkEl = document.getElementById('phone-link');
  linkEl.href = phoneUrl;
  linkEl.textContent = phoneUrl;

  let mqttClient = null;
  let topics = null;
  let pc = null;
  let remoteVideoEl = null;
  let pendingPhoneIce = [];

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function publishJson(topic, obj) {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(topic, JSON.stringify(obj));
    }
  }

  function cleanupPc() {
    pendingPhoneIce = [];
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
  }

  function flushPendingPhoneIce() {
    if (!pc) return;
    var list = pendingPhoneIce.splice(0);
    list.forEach(function (cand) {
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function (e) {
        console.warn('addIceCandidate', e);
      });
    });
  }

  async function handleOffer(sdpPayload) {
    if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
      return;
    }
    cleanupPc();

    pc = new RTCPeerConnection({ iceServers: window.WEBTEX_ICE_SERVERS });

    pc.ontrack = function (ev) {
      const stream = ev.streams[0];
      if (!remoteVideoEl) {
        remoteVideoEl = document.createElement('video');
        remoteVideoEl.playsInline = true;
        remoteVideoEl.muted = true;
        remoteVideoEl.autoplay = true;
      }
      remoteVideoEl.srcObject = stream;
      remoteVideoEl.play().catch(function () {});

      if (window.__webtexSetVideoStream) {
        window.__webtexSetVideoStream(stream);
      }
    };

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        publishJson(topics.iceHost, { candidate: ev.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = function () {
      setStatus('接続: ' + pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('切断されました。スマホで再接続してください。');
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdpPayload));
    flushPendingPhoneIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    publishJson(topics.answer, { type: answer.type, sdp: answer.sdp });
    setStatus('映像を受信中…');
  }

  mqtt.connect(brokerUrl, {
    protocolVersion: 4,
    clientId: 'webtex_host_' + Math.random().toString(36).slice(2, 14),
  })
    .on('connect', function () {
      mqttClient = this;
      const base = 'webrtc/' + roomId;
      topics = {
        offer: base + '/offer',
        answer: base + '/answer',
        iceHost: base + '/ice-host',
        icePhone: base + '/ice-phone',
      };

      this.subscribe([topics.offer, topics.icePhone], function (err) {
        if (err) {
          setStatus('シグナリング接続に失敗しました');
          console.error(err);
          return;
        }
        setStatus('QRをスマホで読み取り、カメラを許可してください');
      });
    })
    .on('message', function (topic, message) {
      const payload = parsePayload(message);
      if (!payload) return;

      if (topic === topics.offer && payload.type === 'offer') {
        handleOffer(payload).catch(function (e) {
          console.error(e);
          setStatus('オファー処理エラー');
        });
        return;
      }

      if (topic === topics.icePhone && payload.candidate) {
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(function (e) {
            console.warn('addIceCandidate', e);
          });
        } else {
          pendingPhoneIce.push(payload.candidate);
        }
      }
    })
    .on('error', function (e) {
      console.error(e);
      setStatus('通信エラー（MQTT）');
    });

  window.addEventListener('beforeunload', function () {
    cleanupPc();
    if (mqttClient) mqttClient.end();
  });
})();
