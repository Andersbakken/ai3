#!/usr/bin/env nodejs
/* global process, require */

const net = require('net');
const fs = require('fs');
const safe = require('safetydance');
const args = require('minimist')(process.argv.slice(1));
const i3 = require('i3');
const path = require('path');

var stack = [];
const client = i3.createClient();
client.on('window', (w) => {
    if (w.change == 'focus' && (!stack.length || w.container.id != stack[stack.length - 1].con_id)) {
        while (stack.length >= 10)
            stack.splice(0, 1);
        if (stack.length) {
            fs.writeFile(path.join(process.env.HOME, ".i3lastwindow"), stack[stack.length - 1].con_id);
        }
        stack.push({con_id: w.container.id, class: w.container.window_properties.class, title: w.container.window_properties.title});
    }
});

process.on('message', (msg) => {
    if (msg.topic == 'process:msg') {
        if (typeof msg.data === 'number') {
            var num;
            if (msg.data < 0) {
                num = stack.length + msg.data;
            } else {
                num = msg.data;
            }
            if (num >= 0 && num < stack.length) {
                client.command(`[con_id="${stack[num].con_id}"] focus`);
            }
        } else {
            console.error("Bad arg");
            return;
        }
    }
});


function clearSocketPath()
{
    const path = args["socket-path"] || "/tmp/ai3.sock";
    safe.fs.unlinkSync(path);
}

process.on('SIGINT', () => {
    clearSocketPath();
    // console.log('Received SIGINT.  Press Control-D to exit.');
    process.exit();
});

process.on('EXIT', () => {
    clearSocketPath();
    // console.log("GOT EXIT");
});

function handleMessage(msg)
{
    let message = safe.JSON.parse(msg);
    if (!message) {
        console.error("bad message", msg);
        return;
    }
    console.log("handle message", message);
}

let server;
var pendingData = "";
function serverCallback(socket)
{
    // console.log("Got a connection");
    // console.log("got thing", socket);
    socket.on('end', () => {
        // exec'd when socket other end of connection sends FIN packet
        // console.log('[socket on end]');
    });
    socket.on('data', (data) => {
        // data is a Buffer object
        pendingData += data.toString();
        let commands = pendingData.split('\n');
        if (commands.length > 1) {
            for (let i=0; i<commands.length - 1; ++i) {
                handleMessage(commands[i]);
            }
            pendingData = commands[commands.length - 1];
        }
        // console.log("got commands", commands, commands.length);
        // console.log('[socket on data]', data, msg);
    });
    socket.on('end', () => {
        console.log("got end");
        // emitted when the other end sends a FIN packet
    });

    socket.on('timeout', () => {
        console.log("got timeout");
    });

    socket.on('drain', () => {
        // emitted when the write buffer becomes empty
        console.log('[socket on drain]');
    });
    socket.on('error', (err) => {
        console.log("got error", err);
    });
    socket.on('close', () => {
        console.log("got close");
    });

    // socket.on('close', log('socket', 'close'));
    socket.pipe(socket);
}

function startServer()
{
    console.log("startServer");
    const path = args["socket-path"] || "/tmp/ai3.sock";
    safe.fs.unlinkSync(path);
    server = net.createServer(serverCallback);
    server.on('err', function(err) {
        console.log(err);
        server.close(function() { console.log("shutting down the server!"); });
    });

    // console.log("balls");
    try {
        server.listen(path);
    } catch (err) {
        // console.log("balls");
        console.error("Failed to listen on ", path);
        safe.fs.unlinkSync(path);
        setTimeout(startServer, 1000);
    }
}

startServer();

console.log(args);
