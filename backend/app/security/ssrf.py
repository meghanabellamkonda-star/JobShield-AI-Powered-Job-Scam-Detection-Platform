import ipaddress
import socket
import urllib.parse
from typing import Tuple

BLOCKED_IP_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # IPv4 loopback
    ipaddress.ip_network("10.0.0.0/8"),       # RFC1918 Private
    ipaddress.ip_network("172.16.0.0/12"),    # RFC1918 Private
    ipaddress.ip_network("192.168.0.0/16"),   # RFC1918 Private
    ipaddress.ip_network("169.254.0.0/16"),   # Link-local / Cloud metadata (AWS, GCP, Azure 169.254.169.254)
    ipaddress.ip_network("0.0.0.0/8"),        # Current network
    ipaddress.ip_network("100.64.0.0/10"),    # Carrier-grade NAT
    ipaddress.ip_network("192.0.0.0/24"),     # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),     # TEST-NET-1
    ipaddress.ip_network("198.51.100.0/24"),  # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),   # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),      # Multicast
    ipaddress.ip_network("240.0.0.0/4"),      # Reserved
    ipaddress.ip_network("::1/128"),          # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),         # IPv6 Unique local
    ipaddress.ip_network("fe80::/10"),        # IPv6 Link-local
]

BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata",
    "instance-data"
}

def validate_url_security(url: str) -> Tuple[bool, str]:
    """
    Validates URL scheme, hostname, and resolves IP addresses to prevent SSRF,
    private-network access, and cloud metadata access.
    """
    if not url or not isinstance(url, str):
        return False, "URL cannot be empty."

    url = url.strip()
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception as e:
        return False, f"Malformed URL format: {str(e)}"

    if parsed.scheme.lower() not in ("http", "https"):
        return False, "Only HTTP and HTTPS URLs are supported."

    hostname = parsed.hostname
    if not hostname:
        return False, "URL must contain a valid host."

    hostname_lower = hostname.lower()
    if hostname_lower in BLOCKED_HOSTNAMES or hostname_lower.endswith(".local") or hostname_lower.endswith(".internal"):
        return False, f"Access to host '{hostname}' is prohibited for security."

    # Check if host is direct IP address
    try:
        ip = ipaddress.ip_address(hostname)
        for net in BLOCKED_IP_NETWORKS:
            if ip in net:
                return False, f"Access to private IP address {ip} is blocked."
        return True, ""
    except ValueError:
        pass # Not a raw IP literal, resolve via DNS

    # DNS Resolution check
    try:
        resolved_ips = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        for item in resolved_ips:
            sockaddr = item[4]
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            for net in BLOCKED_IP_NETWORKS:
                if ip in net:
                    return False, f"Host '{hostname}' resolves to blocked private/local IP {ip}."
    except socket.gaierror:
        return False, f"Could not resolve hostname '{hostname}'."
    except Exception as e:
        return False, f"DNS validation error for '{hostname}': {str(e)}"

    return True, ""
