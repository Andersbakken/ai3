#!/usr/bin/env node
/* global process, require */

const net = require('net');
const fs = require('fs');
const safe = require('safetydance');
const args = require('minimist')(process.argv.slice(1));
// const i3 = require('i3');
const I3 = require('@jhanssen/i3');

const socketPath = args["socket-path"] || "/tmp/ai3.sock";

const i3 = new I3();

// init(opts, config);

var focusChain = [];
i3.open().then(() => {
    // console.log("open");
    // i3.on("workspace", ws => {
    //     // console.log("ws event", ws);
    //     const wss = ws.current;
    //     switch (ws.change) {
    //     case "init":
    //         // add
    //         // workspaces.elements[wss.num] = { name: wss.name, output: wss.output, rect: wss.rect };
    //         // recreate(opts);
    //         break;
    //     case "empty":
    //         // delete workspaces.elements[wss.num];
    //         // recreate(opts);
    //         break;
    //     case "focus":
    //         // workspaces.focused = wss.num;
    //         break;
    //     }
    //     // reselect(opts);
    // });
    i3.on("window", (w) => {
        while (focusChain.length >= 100)
            focusChain.splice(0, 1);
        // focusChain.push({id: w.container.id, "class": w.container.window_properties["class"], title: w.container.window_properties.title});
        focusChain.push(w.container.id);
    });
}).catch(err => {
    console.error(err);
});

function clearSocketPath()
{
    safe.fs.unlinkSync(socketPath);
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

function handleApplicationMessage(msg)
{
    i3.send("GET_TREE").then((tree) => {
        // console.log(typeof tree, Object.keys(tree));
        function match(needle, haystack)
        {
            if (needle instanceof Array) {
                for (let i=0; i<needle.length; ++i) {
                    if (match(needle[i], haystack))
                        return true;
                }
                return false;
            } else {
                return needle == haystack;
            }

        }

        let matches = [];
        function recurse(node) {
            // console.log(node.type, node.name, node.window_properties);
            if (node.type == 'con' && node.window_properties) {
                if (msg.list
                    || msg.last
                    || match(msg["class"], node.window_properties["class"])
                    || match(msg["instance"], node.window_properties["instance"])) {
                    matches.push({ id: node.id,
                                   "class": node.window_properties["class"],
                                   instance: node.window_properties.instance,
                                   title: node.window_properties.title,
                                   name: node.name,
                                   focused: node.focused });
                }
            }
            node.nodes.forEach(recurse);
            node.floating_nodes.forEach(recurse);
        }
        recurse(tree);
        // console.log(containers);
        if (msg.list) {
            console.log(matches);
        } else if (msg.last) {
            let ids = {};
            for (let i=0; i<matches.length; ++i) {
                ids[matches[i].id] = true;
            }

            for (var i=focusChain.length - 2; i>=0; --i) {
                if (focusChain[i] in ids) {
                    i3.send(new I3.Message("COMMAND", `[con_id=${focusChain[i]}] focus`)).then(console.log);
                    console.log(`sending focus to ${focusChain[i]}`);
                    return;
                }
            }
            console.log("Couldn't find anyone to focus");
            return;
        } else if (matches.length) {
            let focus;
            console.log(matches);
            if (matches.length > 1) {
                let ids = {};
                for (let i=0; i<matches.length; ++i) {
                    if (matches[i].focused) {
                        focus = matches[(i + 1) % matches.length].id;
                        break;
                    } else {
                        ids[matches[i].id] = true;
                    }
                }
                if (focus === undefined) {
                    // console.log(focusChain);
                    for (let i=focusChain.length - 1; i>=0; --i) {
                        if (focusChain[i] in ids) {
                            focus = focusChain[i];
                            break;
                        }
                    }
                    if (focus === undefined)
                        focus = matches[0].id;
                }
            } else {
                focus = matches[0].id;
            }
            // console.log(focus);
            // console.log("sending command", "COMMAND", `[con_id: ${focus}] focus`);
            i3.send(new I3.Message("COMMAND", `[con_id=${focus}] focus`)).then(console.log);
        } else if (message.spawn) {
            child_process.spawn(msg.spawn.command, msg.spawn.args, msg.spawn.options);
        }
        // console.log(JSON.stringify(tree, null, 4));
    });
}

function handleMessage(msg)
{
    let message = safe.JSON.parse(msg);
    if (!message) {
        console.error("bad message", msg);
        return;
    }
    console.log("handle message", message);
    switch (message.type) {
    case 'application':
        handleApplicationMessage(message);
        break;
    case 'quit':
        process.exit();
        break;
    }
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
        // console.log("got end");
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
        // console.log("got close");
    });

    // socket.on('close', log('socket', 'close'));
    socket.pipe(socket);
}

var client = net.createConnection(socketPath);

function startServer()
{
    // console.log("startServer");
    clearSocketPath();
    // safe.fs.unlinkSync(socketPath);
    server = net.createServer(serverCallback);
    server.on('err', function(err) {
        console.log(err);
        server.close(function() { console.log("shutting down the server!"); });
    });

    // console.log("balls");
    try {
        server.listen(socketPath);
    } catch (err) {
        // console.log("balls");
        console.error("Failed to listen on ", socketPath, err);
        safe.fs.unlinkSync(socketPath);
        setTimeout(startServer, 1000);
    }
}

client.on('close', startServer);
client.on('error', function() {});
client.on('connect', function() {
    // console.log("got connect");
    client.write(JSON.stringify({type: 'quit'}) + "\n");
    client.pipe(client);
});
