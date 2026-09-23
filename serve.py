import http.server, functools, threading, webbrowser, pathlib, sys
ROOT = pathlib.Path(__file__).parent
PORT = 8000
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
# try fallback ports if busy
for _ in range(5):
    try:
        break
    except OSError:
        PORT += 1
url = f'http://127.0.0.1:{PORT}/index.html'
print(f'Honest Hire running at {url}')
threading.Timer(0.8, lambda: webbrowser.open(url)).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    sys.exit(0)
