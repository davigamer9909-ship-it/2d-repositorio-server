
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Jump Friends Server Online!");
});

const wss = new WebSocket.Server({ server: httpServer });

const rooms = new Map();
const queue = [];

let nextPlayerId = 0;

function send(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function generateCode() {
    let code;

    do {
        code = Math.random().toString(36)
            .substring(2, 8).toUpperCase();
    } while (rooms.has(code));

    return code;
}

function createRoom(players, code = generateCode()) {
    const room = new Map();

    for (const socket of players) {
        socket.roomId = code;
        room.set(socket.playerId, socket);
    }

    rooms.set(code, room);

    console.log("Sala criada:", code);

    return code;
}

function removeFromQueue(socket) {
    const index = queue.indexOf(socket);

    if (index !== -1) {
        queue.splice(index, 1);
    }
}

function findRandomPlayers(socket) {
    if (socket.roomId) return;

    removeFromQueue(socket);
    queue.push(socket);

    send(socket, {
        type: "searching",
        message: "Procurando jogadores..."
    });

    while (queue.length >= 2) {
        const players = [];

        while (queue.length > 0 && players.length < MAX_PLAYERS) {
            const player = queue.shift();

            if (
                player.readyState === WebSocket.OPEN &&
                !player.roomId
            ) {
                players.push(player);
            }
        }

        if (players.length >= 2) {
            const code = createRoom(players);

            for (const player of players) {
                const peers = Array.from(
                    rooms.get(code).keys()
                ).filter(id => id !== player.playerId);

                send(player, {
                    type: "matched",
                    room: code,
                    peer_id: player.playerId,
                    peers: peers
                });
            }
        } else {
            queue.unshift(...players);
            break;
        }
    }
}

function closeRoom(roomId, reason) {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const player of room.values()) {
        player.roomId = null;

        send(player, {
            type: "room_closed",
            message: reason
        });
    }

    rooms.delete(roomId);
}

function leaveRoom(socket) {
    removeFromQueue(socket);

    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);

    if (!room) {
        socket.roomId = null;
        return;
    }

    const wasHost = room.keys().next().value === socket.playerId;

    room.delete(socket.playerId);
    socket.roomId = null;

    for (const player of room.values()) {
        send(player, {
            type: "peer_left",
            peer_id: socket.playerId
        });
    }

    if (wasHost) {
        closeRoom(roomId, "O criador saiu da sala.");
    } else if (room.size === 0) {
        rooms.delete(roomId);
    }
}

wss.on("connection", (socket) => {
    socket.playerId = ++nextPlayerId;
    socket.roomId = null;

    console.log("Conectado:", socket.playerId);

    socket.on("message", (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (msg.type === "quick_match") {
            findRandomPlayers(socket);
        }

        else if (msg.type === "cancel_search") {
            removeFromQueue(socket);

            send(socket, {
                type: "search_cancelled"
            });
        }

        else if (msg.type === "create_room") {
            if (socket.roomId) return;

            removeFromQueue(socket);

            const code = createRoom([socket]);

            send(socket, {
                type: "room_created",
                room: code,
                peer_id: socket.playerId,
                peers: []
            });
        }

        else if (msg.type === "join_room") {
            if (socket.roomId) return;

            removeFromQueue(socket);

            const code = String(msg.room || "").toUpperCase();
            const room = rooms.get(code);

            if (!room) {
                send(socket, {
                    type: "error",
                    message: "Sala não encontrada."
                });
                return;
            }

            if (room.size >= MAX_PLAYERS) {
                send(socket, {
                    type: "error",
                    message: "Sala cheia."
                });
                return;
            }

            const peers = Array.from(room.keys());

            socket.roomId = code;
            room.set(socket.playerId, socket);

            send(socket, {
                type: "room_joined",
                room: code,
                peer_id: socket.playerId,
                peers: peers
            });

            for (const player of room.values()) {
                if (player !== socket) {
                    send(player, {
                        type: "peer_joined",
                        peer_id: socket.playerId
                    });
                }
            }

            console.log("Entrou na sala:", code);
        }

        else if (msg.type === "signal") {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const target = room.get(Number(msg.to));

            if (!target || target === socket) return;

            send(target, {
                type: "signal",
                from: socket.playerId,
                data: msg.data
            });
        }

        else if (msg.type === "leave") {
            leaveRoom(socket);
        }
    });

    socket.on("close", () => {
        leaveRoom(socket);
        console.log("Desconectado:", socket.playerId);
    });

    socket.on("error", (err) => {
        console.log("Erro:", err.message);
    });
});

httpServer.listen(PORT, "0.0.0.0", () => {
    console.log("Jump Friends Online na porta:", PORT);
});
