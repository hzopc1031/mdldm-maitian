import net from 'node:net';

// Port 80 accepts plaintext certificate validation and HTTPS on separate
// loopback listeners. Only the TLS listener serves the password form.
const server=net.createServer(client=>{
  client.on('error',()=>client.destroy());
  client.setTimeout(5000,()=>client.destroy());
  client.once('data',first=>{
    const tls=first[0]===0x16;
    client.pause();
    client.setTimeout(45000);
    const upstream=net.connect(tls?18443:18080,'127.0.0.1');
    upstream.on('error',()=>client.destroy());
    upstream.once('close',()=>client.destroy());
    client.once('close',()=>upstream.destroy());
    upstream.once('connect',()=>{
      if(tls){
        upstream.write(`PROXY TCP4 ${client.remoteAddress} ${client.localAddress} ${client.remotePort} ${client.localPort}\r\n`);
      }
      upstream.write(first);
      client.pipe(upstream).pipe(client);
    });
  });
});
server.maxConnections=80;
server.listen(80,'0.0.0.0');
