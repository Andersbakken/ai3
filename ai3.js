#!/usr/bin/env node
/* global process, require, setTimeout */

const net = require('net');
const fs = require('fs');
const safe = require('safetydance');
const child_process = require('child_process');
const args = require('minimist')(process.argv.slice(1));
const I3 = require('@jhanssen/i3');
const readline = require('readline');

const socketPath = args["socket-path"] || "/tmp/ai3.sock";

const i3 = new I3();

// init(opts, config);

function recurse(msg, node, workspace) {
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

    var ret;
    // console.log(node.type, node.name, node.window_properties);
    if (node.type == 'workspace') {
        // console.log("got workspace", node.name, node.focused);
        workspace = node.name;
    } else if (node.type == 'con' && node.window_properties) {
        if (msg.conid == node.id
            || msg.list
            || msg.last
            || match(msg["class"], node.window_properties["class"])
            || match(msg["instance"], node.window_properties["instance"])) {
            ret = [ { id: node.id,
                      "class": node.window_properties["class"],
                      workspace: workspace,
                      instance: node.window_properties.instance,
                      title: node.window_properties.title,
                      name: node.name,
                      focused: node.focused } ];
        }
    }
    function add(result) {
        if (result) {
            if (!ret) {
                ret = result;
            } else {
                ret = ret.concat(result);
            }
        }
    }
    for (var i=0; i<node.nodes.length; ++i)
        add(recurse(msg, node.nodes[i], workspace));
    for (var i=0; i<node.floating_nodes.length; ++i)
        add(recurse(msg, node.floating_nodes[i], workspace));

    return ret;
}

function isReallyFocused(conid)
{
    // console.log("calling isReallyFocused", conid);
    return Promise.all([i3.send("GET_TREE"), i3.send("GET_WORKSPACES")]).then((results) => {
        var matches = recurse({conid: conid}, results[0]);
        if (matches && matches.length == 1 && matches[0].workspace) {
            for (var i=0; i<results[1].length; ++i) {
                if (matches[0].workspace === results[1][i].name) {
                    return results[1][i].visible;
                }
            }
        }
        console.log("got matches", matches);
        // fs.writeFileSync("tree", JSON.stringify(results[0], null, 4));
        // fs.writeFileSync("workspaces", JSON.stringify(results[1], null, 4));
        // console.log(results.length);
        return false;
    }).catch((err) => {
        console.log("caught something", err.stack);
    });
}

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
        if (w.change != 'focus')
            return;
        // console.log("got event", w);
        while (focusChain.length >= 100)
            focusChain.splice(0, 1);
        // focusChain.push({id: w.container.id, "class": w.container.window_properties["class"], title: w.container.window_properties.title});
        isReallyFocused(w.container.id).then((visible) => {
            if (visible && !focusChain.length || (w.container.id != focusChain[focusChain.length - 1].conid)) {
            // console.log("checking for", w.container.id, (focusChain.length ? focusChain[focusChain.length - 1].conid : "nothing"));

                console.log(w.container.window_properties["class"], "is visible");
                // if (w.container.window_properties["class"] == "XTerm") {
                //     i3.send("GET_TREE").then((tree) => {
                //         var matches = recurse({class: 'Netflix'}, tree);
                //         console.log("looking for netflix", matches);
                //         if (matches) {
                //             matches.forEach((match) => {
                //                 i3.send(new I3.Message("COMMAND", `[con_id=${match.id}] move to workspace 4`)).then(() => {
                //                     i3.send(new I3.Message("COMMAND", `workspace 1`)).then(console.log);
                //                 });
                //             });
                //         }
                //     });
                // } else if (w.container.window_properties["class"] = "Netflix") {
                //     i3.send(new I3.Message("COMMAND", `[con_id=${w.container.id}] move to workspace 1`)).then(() => {
                //         i3.send(new I3.Message("COMMAND", `workspace 1`)).then(console.log);
                //     });
                // }
                focusChain.push({conid: w.container.id, winid: w.container.window, "class": w.container.window_properties["class"], instance: w.container.window_properties.instance});
                // console.log(focusChain.slice(-5));
            } else {
                console.log(w.class, "is not visible");
            }
        });
        // console.log("got shit", w);
    });
    // i3.on("workspace", (w) => {
    //     console.log("got workspace", w);
    // });
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
        var matches = recurse(msg, tree);
        // console.log(containers);
        if (msg.list) {
            console.log(matches);
        } else if (msg.last) {
            let ids = {};
            for (let i=0; i<matches.length; ++i) {
                ids[matches[i].id] = true;
            }

            console.log(matches);

            for (var i=focusChain.length - 2; i>=0; --i) {
                if (focusChain[i].conid in ids) {
                    i3.send(new I3.Message("COMMAND", `[con_id=${focusChain[i].conid}] focus`)).then(console.log);
                    console.log(`sending focus to ${focusChain[i].class}`);
                    if (msg.output)
                        safe.fs.writeFileSync(msg.output, `CONID=${focusChain[i].conid}\nWINID=${focusChain[i].winid}\nCLASS=${focusChain[i].class}\nINSTANCE=${focusChain[i].instance}\n`);
                    return;
                }
            }
            console.log("Couldn't find anyone to focus");
            return;
        } else if (matches && matches.length) {
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
                        if (focusChain[i].conid in ids) {
                            focus = focusChain[i].conid;
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
        } else if (msg.spawn) {
            child_process.spawn(msg.spawn.command, msg.spawn.args, msg.spawn.options);
        }
        // console.log(JSON.stringify(tree, null, 4));
    }).catch((err) => {
        console.log("Caught an error", err);
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

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', function(line) {
    if (line == "focuschain") {
        console.log(JSON.stringify(focusChain, null, 4));
    }
    // console.log("got line", line, "shit");
})
