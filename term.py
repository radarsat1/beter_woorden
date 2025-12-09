from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import asyncio
from rich.console import Console

app = FastAPI()
console = Console()

html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Terminal Emulator</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.css" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/3.0.3/socket.io.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
    <script type="module">
        document.addEventListener('DOMContentLoaded', () => {
            const terminalDiv = document.getElementById('terminal');
            const terminal = new Terminal({convertEol: true, cols: 100,
                                           fontFamily: 'Fira Code, monospace'});
            const socket = new WebSocket(`ws://${window.location.host}/ws`);

            terminal.open(terminalDiv);
            terminal.write('\\n$ '); // Initial prompt

            socket.onmessage = function(event) {
                // Display output with new prompt
                console.log(event.data);
                terminal.write(event.data);
            };

            // Handle key presses
            terminal.onKey(({ key, domEvent }) => {
                if (domEvent.key === 'Enter') {
                    // Capture the command for sending when Enter is pressed
                    const inputLine = terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.buffer.active.cursorY);

                    // TODO: This doesn't work for interactive programs, find a different way
                    const command = inputLine.translateToString().slice(2); // Remove the prompt and capture command

                    if (command.trim() !== '') {
                        socket.send(command); // Send command to the server
                    }
                    terminal.write('\\n');
                } else if (domEvent.key === 'Backspace') {
                    // Handle backspace:
                    terminal.write('\\b \\b'); // Remove the character visually
                } else {
                    terminal.write(key); // Write any other keys directly
                }

                domEvent.preventDefault(); // Prevent default behavior
            });

            terminalDiv.addEventListener("click", () => {
                terminal.focus(); // Focus the terminal when clicked
            });
        });
    </script>
    <style>
        #terminal {
            width: 100%;
            height: 400px; /* Set a height for the terminal */
            border: 1px solid #ccc;
            background-color: black;
        }
    </style>
</head>
<body>
    <div id="terminal"></div>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def get():
    return html

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await execute_command(websocket, data)
    except WebSocketDisconnect:
        print("Client disconnected")

async def execute_command(websocket: WebSocket, command: str):
    # NOTES: Some weirdness about waiting for the program to exit.

    # Create an asyncio subprocess
    process = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Stream stdout
    while True:
        output = await process.stdout.readline()  # Non-blocking read
        if output == '' and process.returncode is not None:
            break
        if output:
            await websocket.send_text(output.decode('utf8'))

    # Stream stderr (if any)
    stderr_output = await process.stderr.read()
    if stderr_output:
        await websocket.send_text(stderr_output.strip())
        print('Sent error:', stderr_output.strip())

    await process.wait()  # Ensure the process is completed before exiting the function

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
