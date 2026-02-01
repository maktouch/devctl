# HTTPS Proxy

DevCTL includes a sophisticated reverse-proxy system that allows you to develop with HTTPS locally. This enables you to test SSL-dependent features (secure cookies, service workers, WebAuthn, etc.) in a realistic development environment.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Global Proxy Settings](#global-proxy-settings)
  - [Per-Service Proxy Routes](#per-service-proxy-routes)
- [Setting Up SSL Certificates](#setting-up-ssl-certificates)
- [How Routing Works](#how-routing-works)
- [Advanced Configuration](#advanced-configuration)
- [Troubleshooting](#troubleshooting)
- [Technical Details](#technical-details)

## Overview

The DevCTL proxy is a reverse proxy that runs in a Docker container and routes HTTP/HTTPS requests to your local services based on the Host header and URL path. It supports:

- **HTTP and HTTPS** - Configurable ports with SSL certificate support
- **WebSocket proxying** - Real-time connections work seamlessly
- **Smart routing** - Host-based and path-based routing with specificity matching
- **Automatic configuration** - Compiles from your `.devctl.yaml` into Docker Compose

## Quick Start

### Basic HTTP Proxy

The simplest configuration enables HTTP proxying on port 80:

```yaml
# .devctl.yaml
proxy:
  enabled: true

services:
  - name: 'frontend'
    proxy:
      - port: 3000
        paths:
          - localhost
```

This routes all requests to `http://localhost` to your frontend service running on port 3000.

### HTTPS Proxy

To enable HTTPS, you need SSL certificates. Here's a complete setup:

1. **Install mkcert** (one-time setup):
   ```bash
   # macOS
   brew install mkcert
   mkcert -install

   # Linux
   # See https://github.com/FiloSottile/mkcert#installation
   ```

2. **Generate certificates**:
   ```bash
   mkdir -p .devctl/ssl
   mkcert -key-file .devctl/ssl/example.local-key.pem \
          -cert-file .devctl/ssl/example.local.pem \
          example.local "*.example.local"
   ```

3. **Configure DevCTL**:
   ```yaml
   # .devctl.yaml
   proxy:
     enabled: true
     ssl:
       key: .devctl/ssl/example.local-key.pem
       cert: .devctl/ssl/example.local.pem

   services:
     - name: 'frontend'
       proxy:
         - port: 3000
           paths:
             - example.local
   ```

4. **Add to /etc/hosts**:
   ```bash
   echo "127.0.0.1 example.local" | sudo tee -a /etc/hosts
   ```

5. **Start DevCTL**:
   ```bash
   devctl switch
   ```

Now you can access your app at `https://example.local` with a valid SSL certificate!

## Configuration

### Global Proxy Settings

The global `proxy` section in `.devctl.yaml` controls the proxy server itself:

```yaml
proxy:
  # Enable or disable the proxy
  enabled: true

  # HTTP port (default: 80)
  httpPort: 80

  # HTTPS port (default: 443, only used when SSL is configured)
  httpsPort: 443

  # SSL configuration (optional)
  ssl:
    # Path to private key file
    key: .devctl/ssl/example.local-key.pem

    # Path to certificate file (can include intermediate certs)
    cert: .devctl/ssl/example.local.pem
```

**Port Behavior:**
- If SSL is configured and `httpsPort` is omitted, it defaults to 443
- If SSL is NOT configured and `httpPort` is omitted, it defaults to 80
- Both HTTP and HTTPS can run simultaneously when SSL is configured

### Per-Service Proxy Routes

Each service can define one or more proxy configurations:

```yaml
services:
  - name: 'frontend'
    proxy:
      # You can have multiple proxy configs per service
      - port: 3000              # Target port where service is running
        protocol: http          # Optional: http or https (default: http)
        paths:                   # Array of domain/path patterns to match
          - localhost                    # Matches http://localhost
          - example.local                # Matches http://example.local
          - example.local/app            # Matches http://example.local/app/*
          - api.example.local            # Matches http://api.example.local

  - name: 'backend'
    proxy:
      - port: 8080
        paths:
          - api.example.local/v1         # Matches http://api.example.local/v1/*
```

**Path Format:** `{domain}{path}`
- Domain only: `example.local` - Matches all requests to that domain
- Domain + path: `example.local/api` - Matches only requests to that path
- Subdomain: `api.example.local` - Matches the subdomain
- Localhost: `localhost` or `localhost:8080` - Matches localhost requests

## Setting Up SSL Certificates

### Using mkcert (Recommended)

[mkcert](https://github.com/FiloSottile/mkcert) automatically creates locally-trusted certificates:

```bash
# Install mkcert
brew install mkcert  # macOS
# or follow https://github.com/FiloSottile/mkcert#installation

# Install the local CA
mkcert -install

# Create directory for certificates
mkdir -p .devctl/ssl

# Generate certificate for your domain(s)
mkcert -key-file .devctl/ssl/myapp.local-key.pem \
       -cert-file .devctl/ssl/myapp.local.pem \
       myapp.local "*.myapp.local" localhost 127.0.0.1
```

**Best Practices:**
- Use `.local` domains for development (e.g., `myapp.local`, `api.myapp.local`)
- Generate wildcard certificates for subdomains: `"*.example.local"`
- Include `localhost` and `127.0.0.1` if needed
- Store certificates in `.devctl/ssl/` (add to `.gitignore`)
- Each developer should generate their own certificates (don't commit to git)

### Using Custom Certificates

If you have existing certificates or use a different tool:

```yaml
proxy:
  enabled: true
  ssl:
    key: /path/to/private-key.pem
    cert: /path/to/certificate.pem  # Can include full chain
```

The certificate file can contain:
- The server certificate
- Intermediate certificates (concatenated)
- The full certificate chain

## How Routing Works

The proxy routes requests based on the **Host header** and **URL path**.

### Routing Priority

When multiple routes could match a request, the **most specific** route wins:

```yaml
services:
  - name: 'frontend'
    proxy:
      - port: 3000
        paths:
          - example.local           # Less specific

  - name: 'api'
    proxy:
      - port: 8080
        paths:
          - example.local/api       # More specific - wins for /api/* requests
```

Request routing:
- `https://example.local/` → frontend:3000
- `https://example.local/about` → frontend:3000
- `https://example.local/api/users` → api:8080 (more specific match)

### Routing Algorithm

1. Extract the Host header from the incoming request
2. Build the match key: `{host}{pathname}` (e.g., `example.local/api/users`)
3. Find all configured routes that are prefixes of the match key
4. Select the **longest matching prefix** (most specific route)
5. Proxy to the corresponding service

### Example Routing Configuration

```yaml
services:
  - name: 'main-app'
    proxy:
      - port: 3000
        paths:
          - app.local

  - name: 'admin-panel'
    proxy:
      - port: 3001
        paths:
          - app.local/admin

  - name: 'api'
    proxy:
      - port: 8080
        paths:
          - api.app.local

  - name: 'docs'
    proxy:
      - port: 4000
        paths:
          - docs.app.local
```

Routing results:
- `https://app.local/` → main-app:3000
- `https://app.local/dashboard` → main-app:3000
- `https://app.local/admin` → admin-panel:3001 (more specific)
- `https://app.local/admin/users` → admin-panel:3001
- `https://api.app.local/v1/users` → api:8080
- `https://docs.app.local/` → docs:4000

## Advanced Configuration

### Multiple Domains per Service

A single service can respond to multiple domains:

```yaml
services:
  - name: 'web'
    proxy:
      - port: 3000
        paths:
          - example.local
          - app.local
          - localhost
```

### Multiple Services with Different Protocols

```yaml
services:
  - name: 'frontend'
    proxy:
      - port: 3000
        protocol: http
        paths:
          - app.local

  - name: 'backend'
    proxy:
      - port: 8443
        protocol: https  # Backend service already serves HTTPS
        paths:
          - api.app.local
```

### Port-based Development

For local development, you can use port numbers in paths:

```yaml
services:
  - name: 'frontend'
    proxy:
      - port: 3000
        paths:
          - localhost:3000

  - name: 'backend'
    proxy:
      - port: 8080
        paths:
          - localhost:8080
```

### WebSocket Support

WebSocket connections are automatically proxied. No special configuration needed:

```yaml
services:
  - name: 'realtime'
    proxy:
      - port: 4000
        paths:
          - ws.example.local
```

Your WebSocket clients can connect to `wss://ws.example.local` (or `ws://` for HTTP).

## Troubleshooting

### Certificate Not Trusted

**Problem:** Browser shows "Your connection is not private" error.

**Solution:**
1. Ensure mkcert's local CA is installed: `mkcert -install`
2. Restart your browser after installing the CA
3. Verify certificate files exist and are readable
4. Check certificate was generated for the correct domain

### Connection Refused

**Problem:** Cannot connect to the proxy.

**Solutions:**
1. Check proxy is enabled: `proxy.enabled: true`
2. Verify proxy container is running: `docker ps | grep devctl-proxy`
3. Check port conflicts: `lsof -i :80` or `lsof -i :443`
4. Ensure Docker has permission to bind to privileged ports (< 1024)
5. On macOS, check if port 80/443 is used by another service

### Wrong Service Receiving Requests

**Problem:** Requests go to the wrong service.

**Solutions:**
1. Check path specificity - more specific paths should be listed
2. Verify Host header matches configured paths
3. Check `/etc/hosts` entries point to `127.0.0.1`
4. Review routing with most specific path matching rules
5. Check for typos in domain names

### Changes Not Applied

**Problem:** Configuration changes don't take effect.

**Solutions:**
1. Recompile and restart: `devctl down && devctl switch`
2. Check `.devctl.compiled/docker-compose.yaml` for `DEVCTL_PROXY` environment variable
3. Verify proxy service in docker-compose has the correct image and environment

### Port Already in Use

**Problem:** `Error: Port 80/443 already in use`

**Solutions:**
1. Stop conflicting services:
   ```bash
   # macOS - stop Apache if running
   sudo apachectl stop

   # Linux - stop nginx/apache
   sudo systemctl stop nginx
   sudo systemctl stop apache2
   ```
2. Use alternative ports:
   ```yaml
   proxy:
     httpPort: 8080
     httpsPort: 8443
   ```
   Then access via `http://localhost:8080` or `https://localhost:8443`

### Viewing Proxy Logs

Check proxy container logs for debugging:

```bash
devctl logs devctl-proxy
```

### SSL Handshake Errors

**Problem:** SSL/TLS handshake failures.

**Solutions:**
1. Verify certificate and key files match
2. Check file paths are correct and relative to project root
3. Ensure certificate includes the full chain if needed
4. Verify certificate is valid for the domain you're accessing

## Technical Details

### Architecture

The DevCTL proxy consists of:

1. **Configuration Compiler** (`src/commands/compile.ts`)
   - Reads `.devctl.yaml` configuration
   - Loads SSL certificates from filesystem
   - Compiles routes from service proxy configs
   - Generates `DEVCTL_PROXY` environment variable (JSON)
   - Adds `devctl-proxy` service to docker-compose

2. **Proxy Server** (`packages/devctl-proxy/index.js`)
   - Node.js Express application
   - Uses `http-proxy-middleware` for reverse proxying
   - Loads configuration from `DEVCTL_PROXY` environment variable
   - Creates HTTP server (always)
   - Creates HTTPS server (when SSL configured)
   - Routes requests using custom router function

### Environment Variable Structure

The `DEVCTL_PROXY` environment variable contains:

```json
{
  "routes": {
    "example.local": "http://dockerhost:3000",
    "example.local/api": "http://dockerhost:8080",
    "api.example.local": "http://dockerhost:8080"
  },
  "proxy": {
    "enabled": true,
    "httpPort": 80,
    "httpsPort": 443,
    "ssl": {
      "key": "-----BEGIN PRIVATE KEY-----\n...",
      "cert": "-----BEGIN CERTIFICATE-----\n..."
    }
  }
}
```

### Docker Integration

The proxy runs as a Docker service:

```yaml
services:
  devctl-proxy:
    image: splitmedialabs/devctl-proxy:latest
    ports:
      - "80:80"      # HTTP
      - "443:443"    # HTTPS (if SSL configured)
    environment:
      - DEVCTL_PROXY={"routes":{...},"proxy":{...}}
```

### Routing Implementation

The router function:
1. Receives incoming request
2. Extracts Host header and pathname
3. Builds match key: `${host}${pathname}`
4. Finds all route prefixes that match
5. Selects longest prefix (most specific)
6. Returns target URL for proxying

```javascript
// Simplified routing logic
function router(req) {
  const host = req.headers.host;
  const pathname = new URL(req.url, `http://${host}`).pathname;
  const matchKey = `${host}${pathname}`;

  // Find most specific matching route
  const availableRoutes = Object.keys(routes).filter(route =>
    matchKey.startsWith(route)
  );

  const bestMatch = availableRoutes.sort((a, b) =>
    b.length - a.length
  )[0];

  return routes[bestMatch];
}
```

### Dependencies

- **express** - Web framework
- **http-proxy-middleware** - Proxy middleware with WebSocket support
- **lodash.get** - Safe property access
- **dotenv** - Environment variable loading

### Docker Image

- **Base:** Node 10.15.1-alpine
- **Registry:** `splitmedialabs/devctl-proxy:latest`
- **Build:** Multi-stage build with production dependencies only
- **Entry:** `node index.js`

## Best Practices

1. **Use `.local` TLD** - Reserve `.local` for local development domains
2. **Wildcard Certificates** - Generate `*.example.local` for flexibility
3. **Don't Commit Certificates** - Add `.devctl/ssl/` to `.gitignore`
4. **Document Required Domains** - List required `/etc/hosts` entries in your project README
5. **Use Specific Routes** - Define specific paths before general ones for clarity
6. **Restart After Changes** - Always run `devctl down && devctl switch` after config changes
7. **Check Logs** - Use `devctl logs devctl-proxy` to debug routing issues
8. **Standard Ports** - Use 80/443 when possible for realistic development environment

## Related Documentation

- [.devctl.yaml Reference](./references/.devctl.yaml.md)
- [Docker Compose Integration](./references/.devctl.yaml.md)
- [mkcert Documentation](https://github.com/FiloSottile/mkcert)
