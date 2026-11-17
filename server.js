
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = new WebSocket.Server({
    port: PORT
});

const rooms = new Map();

console.log("Jump Friends Server iniciado!");

server.on("connection", (socket) => {

    let roomId = null;

    socket.on("message", (data) => {

        let msg;

        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }

        // Criar sala
        if (msg.type === "create") {

            roomId = msg.room;

            if (!roomId || rooms.has(roomId)) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Sala inválida ou já existente."
                }));
                return;
            }

            rooms.set(roomId, new Set([socket]));

            socket.send(JSON.stringify({
                type: "created",
                room: roomId
            }));

            console.log("Sala criada:", roomId);
        }

        // Entrar na sala
        else if (msg.type === "join") {

            roomId = msg.room;

            const room = rooms.get(roomId);

            if (!room || room.size >= 4) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Sala não encontrada ou cheia."
                }));
                return;
            }

            socket.send(JSON.stringify({
                type: "joined",
                room: roomId
            }));

            room.forEach(client => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "peer_joined"
                    }));
                }
            });

            room.add(socket);

            console.log("Jogador entrou:", roomId);
        }

        // Encaminhar sinalização WebRTC
        else if (msg.type === "signal") {

            const room = rooms.get(roomId);

            if (!room) return;

            room.forEach(client => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "signal",
                        data: msg.data
                    }));
                }
            });
        }

    });

    socket.on("close", () => {

        if (!roomId) return;

        const room = rooms.get(roomId);

        if (!room) return;

        room.delete(socket);

        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "peer_left"
                }));
            }
        });

        if (room.size === 0) {
            rooms.delete(roomId);
            console.log("Sala removida:", roomId);
        }
    });

});
