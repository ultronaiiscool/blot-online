function send(obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    ...obj,
    type: obj.type || obj.t
  }));
}
