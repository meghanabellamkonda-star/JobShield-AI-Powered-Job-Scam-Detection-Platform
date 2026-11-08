import re
import urllib.parse
from typing import Optional, Dict, Any, Tuple
import httpx
from app.schemas.job import JobData
from app.security.ssrf import validate_url_security
from app.extractors.parser import parse_html_job_page, clean_text

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

class RetrievalResult:
    def __init__(self, success: bool, status: str, message: str, html: str = "", platform: str = "unknown"):
        self.success = success
        self.status = status # success, auth_required, bot_blocked, not_found, timeout, error
        self.message = message
        self.html = html
        self.platform = platform

def detect_platform_from_url(url: str) -> str:
    host = urllib.parse.urlparse(url).hostname or ""
    host = host.lower()
    if "linkedin.com" in host:
        return "linkedin"
    if "indeed." in host:
        return "indeed"
    if "ziprecruiter.com" in host:
        return "ziprecruiter"
    return "company_careers"

async def retrieve_job_url(url: str) -> RetrievalResult:
    """
    Safely retrieves a job URL with SSRF checks, redirect hop validation,
    request size caps, and platform term compliance.
    """
    is_safe, error_msg = validate_url_security(url)
    if not is_safe:
        return RetrievalResult(False, "security_blocked", f"URL security validation failed: {error_msg}")

    platform = detect_platform_from_url(url)

    # Note: LinkedIn and Indeed aggressively enforce authentication and anti-bot challenges on server-side requests.
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none"
    }

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
            current_url = url
            response = None

            # Follow up to 3 redirects safely with SSRF re-check on every hop
            for _ in range(3):
                response = await client.get(current_url, headers=headers)
                if response.status_code in (301, 302, 303, 307, 308):
                    loc = response.headers.get("Location")
                    if not loc:
                        break
                    next_url = urllib.parse.urljoin(current_url, loc)
                    # Check next redirect destination for SSRF
                    safe, redirect_err = validate_url_security(next_url)
                    if not safe:
                        return RetrievalResult(False, "security_blocked", f"Redirect to prohibited address blocked: {redirect_err}")
                    current_url = next_url
                else:
                    break

            if response is None:
                return RetrievalResult(False, "error", "No response received from remote server.")

            # Check status codes
            if response.status_code == 404:
                return RetrievalResult(False, "not_found", "The job posting could not be found (HTTP 404).")
            if response.status_code in (401, 403) or "authwall" in str(response.url) or "login" in str(response.url):
                return RetrievalResult(
                    False,
                    "auth_required",
                    f"{platform.capitalize()} requires authentication or login to access this posting. Please copy and paste the job description text below for an instant risk assessment.",
                    platform=platform
                )

            # Check response size (cap at 2MB)
            if len(response.content) > 2 * 1024 * 1024:
                return RetrievalResult(False, "size_exceeded", "Remote page exceeded maximum size limit.")

            html = response.text

            # Check if LinkedIn / Indeed served a login wall or captcha block in 200 OK
            if "linkedin.com" in current_url:
                if "join-form" in html or "authwall" in html or "Sign in to view" in html or "join_now" in html:
                    return RetrievalResult(
                        False,
                        "auth_required",
                        "LinkedIn presented an authentication requirement for this listing. Please paste the job description text below to analyze it without logging in.",
                        platform="linkedin"
                    )

            if "indeed." in current_url:
                if "cf-browser-verification" in html or "challenge-running" in html or "hcaptcha" in html:
                    return RetrievalResult(
                        False,
                        "bot_blocked",
                        "Indeed automated access verification required. Please paste the job description text into the manual analyzer below.",
                        platform="indeed"
                    )

            return RetrievalResult(True, "success", "Page retrieved successfully", html=html, platform=platform)

    except httpx.TimeoutException:
        return RetrievalResult(False, "timeout", "Connection to the job portal timed out after 8 seconds.")
    except Exception as e:
        return RetrievalResult(False, "error", f"Could not retrieve posting: {str(e)}")
