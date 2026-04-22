(function () {
  const brokerUrl = 'wss://broker.hivemq.com:8884/mqtt';

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');

  const statusEl = document.getElementById('status');
  const preview = document.getElementById('preview');
  const btnCameraToggle = document.getElementById('btn-camera-toggle');
  const cameraLabelEl = document.getElementById('camera-label');

  let localStream = null;
  let videoSender = null;
  /** 既定: アウトカメ（背面） */
  let useBackCamera = true;

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function parsePayload(message) {
    try {
      return JSON.parse(message.toString());
    } catch {
      return null;
    }
  }

  if (!roomId || !/^[0-9a-f]{16}$/i.test(roomId)) {
    setStatus('URLに room がありません。PC側のQRコードから開いてください。');
    throw new Error('invalid room');
  }

  let mqttClient = null;
  let topics = null;
  let pc = null;
  let offerInterval = null;
  let answered = false;
  let pendingHostIce = [];

  function publishJson(topic, obj) {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(topic, JSON.stringify(obj));
    }
  }

  function cleanupPc() {
    pendingHostIce = [];
    if (offerInterval) {
      clearInterval(offerInterval);
      offerInterval = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(function (t) {
        t.stop();
      });
      localStream = null;
    }
    videoSender = null;
    if (btnCameraToggle) {
      btnCameraToggle.disabled = true;
      btnCameraToggle.onclick = null;
      btnCameraToggle.removeEventListener('click', onCameraToggleClick);
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.close();
      pc = null;
    }
  }

  function flushPendingHostIce() {
    if (!pc || !pc.remoteDescription) return;
    var list = pendingHostIce.splice(0);
    list.forEach(function (cand) {
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function (e) {
        console.warn('addIceCandidate', e);
      });
    });
  }

  function facingModeValue() {
    return useBackCamera ? 'environment' : 'user';
  }

  function updateCameraUi() {
    if (cameraLabelEl) {
      cameraLabelEl.textContent = useBackCamera ? 'アウトカメ（背面）' : 'インカメ（前面）';
    }
    if (btnCameraToggle) {
      btnCameraToggle.textContent = useBackCamera ? 'インカメに切替' : 'アウトカメに切替';
    }
  }

  /**
   * 多くの端末では「既にカメラ使用中」のまま別の getUserMedia を掛けると失敗するため、
   * exact → ideal → ラベル無し の順で試す。
   */
  async function acquireStream() {
    const facing = facingModeValue();
    const attempts = [
      {
        video: {
          facingMode: { exact: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      },
      { video: true, audio: false },
    ];
    var lastErr = null;
    for (var i = 0; i < attempts.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempts[i]);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('getUserMedia failed');
  }

  async function onCameraToggleClick(ev) {
    if (ev) ev.preventDefault();
    if (!pc || !localStream || !videoSender) return;

    useBackCamera = !useBackCamera;
    updateCameraUi();

    localStream.getTracks().forEach(function (t) {
      t.stop();
    });

    try {
      const next = await acquireStream();
      const vtrack = next.getVideoTracks()[0];
      await videoSender.replaceTrack(vtrack);
      preview.srcObject = next;
      localStream = next;
    } catch (e) {
      console.error(e);
      useBackCamera = !useBackCamera;
      updateCameraUi();
      try {
        const fallback = await acquireStream();
        await videoSender.replaceTrack(fallback.getVideoTracks()[0]);
        preview.srcObject = fallback;
        localStream = fallback;
      } catch (e2) {
        console.error(e2);
        setStatus('カメラ切替に失敗しました。ページを再読み込みしてください。');
      }
    }
  }

  async function startCameraAndCall() {
    useBackCamera = true;
    updateCameraUi();

    const stream = await acquireStream();
    localStream = stream;
    preview.srcObject = stream;

    pc = new RTCPeerConnection({ iceServers: window.WEBTEX_ICE_SERVERS });
    stream.getTracks().forEach(function (t) {
      pc.addTrack(t, stream);
    });
    videoSender = pc.getSenders().filter(function (s) {
      return s.track && s.track.kind === 'video';
    })[0] || null;

    if (btnCameraToggle) {
      btnCameraToggle.disabled = false;
      btnCameraToggle.addEventListener('click', onCameraToggleClick);
    }

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        publishJson(topics.icePhone, { candidate: ev.candidate.toJSON() });
      }
    };

    async function sendOffer() {
      if (answered) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      publishJson(topics.offer, { type: offer.type, sdp: offer.sdp });
    }

    await sendOffer();
    offerInterval = setInterval(function () {
      if (!answered) sendOffer().catch(console.error);
    }, 3000);
  }

  mqtt.connect(brokerUrl, {
    protocolVersion: 4,
    clientId: 'webtex_phone_' + Math.random().toString(36).slice(2, 14),
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

      this.subscribe([topics.answer, topics.iceHost], async function (err) {
        if (err) {
          setStatus('シグナリング接続に失敗しました');
          console.error(err);
          return;
        }
        try {
          setStatus('カメラを起動しています…');
          await startCameraAndCall();
          setStatus('PC側で表示されるまでお待ちください');
        } catch (e) {
          console.error(e);
          setStatus('カメラが使えません（HTTPSと権限を確認）');
        }
      });
    })
    .on('message', function (topic, message) {
      const payload = parsePayload(message);
      if (!payload) return;

      if (topic === topics.answer && payload.type === 'answer' && pc && !answered) {
        answered = true;
        if (offerInterval) {
          clearInterval(offerInterval);
          offerInterval = null;
        }
        pc.setRemoteDescription(new RTCSessionDescription(payload))
          .then(function () {
            flushPendingHostIce();
            setStatus('接続済み — 映像を送信中');
          })
          .catch(function (e) {
            console.error(e);
            setStatus('接続に失敗しました');
          });
        return;
      }

      if (topic === topics.iceHost && payload.candidate) {
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(function (e) {
            console.warn('addIceCandidate', e);
          });
        } else {
          pendingHostIce.push(payload.candidate);
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
