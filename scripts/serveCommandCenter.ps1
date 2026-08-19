<#
Minimal static file server for local dev of command-center/index.html.

Why this exists: the Command Center fetches .colaberry/plan.json,
progress.json, and manifest.json at runtime (browser fetch()), which
file:// pages cannot do (CORS blocks local file reads). Node.js is not
installed on this machine, so this uses .NET's built-in HttpListener
instead of `npx serve` -- zero install, zero dependencies.

Usage:
  powershell -File scripts/serveCommandCenter.ps1 [-Port 8420]

Serves the entire repo root (read-only) so relative fetches like
"/.colaberry/plan.json" and "/command-center/index.html" resolve
naturally. Ctrl+C to stop.
#>
param(
    [int]$Port = 8420
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Error "Failed to bind $prefix -- $($_.Exception.Message)"
    exit 1
}

Write-Output "Serving $RepoRoot"
Write-Output "Open: http://localhost:$Port/command-center/index.html"
Write-Output "Ctrl+C to stop."

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $urlPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
            if ($urlPath -eq "/") { $urlPath = "/command-center/index.html" }

            $relativePath = $urlPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $relativePath))

            # Prevent path traversal outside the repo root.
            if (-not $fullPath.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if (-not (Test-Path $fullPath -PathType Leaf)) {
                $response.StatusCode = 404
                $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $urlPath")
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
            $contentType = $MimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $response.StatusCode = 500
        } finally {
            $response.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
