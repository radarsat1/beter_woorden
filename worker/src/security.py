import os
import logging
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt # PyJWT library
from jwt.exceptions import PyJWTError, PyJWKClientError

# Load trusted projects from an environment variable (comma-separated)
# SUPABASE_PROJECTS="project-a.supabase.co,project-b.supabase.co"
TRUSTED_DOMAINS = os.getenv("SUPABASE_PROJECTS", "").split(",")

security = HTTPBearer()

logger = logging.getLogger("uvicorn.error") # Merges with uvicorn logs

# We use a dictionary to cache JWK clients for each project
jwks_clients = {}

def get_jwks_client(domain: str):
    if domain not in jwks_clients:
        # Construct the standard Supabase JWKS URL
        url = f"https://{domain}/auth/v1/.well-known/jwks.json"
        jwks_clients[domain] = jwt.PyJWKClient(url, cache_keys=True)
    return jwks_clients[domain]

async def verify_jwt(cred: HTTPAuthorizationCredentials = Security(security)):
    token = cred.credentials
    try:
        # Get the 'iss' claim without verifying yet
        unverified_payload = jwt.decode(token, options={"verify_signature": False})
        issuer_url = unverified_payload.get("iss", "") # e.g., "https://xyz.supabase.co/auth/v1"

        # Extract the domain and check the whitelist
        domain = issuer_url.replace("https://", "").replace("/auth/v1", "")

        if domain not in TRUSTED_DOMAINS:
            raise HTTPException(status_code=403, detail="Untrusted issuer")

        # Get the cached client and verify for real
        jwks_client = get_jwks_client(domain)
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        data = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience="authenticated",
            issuer=issuer_url
        )
        return data
    except PyJWKClientError as e:
        # This triggers if the worker can't REACH the Supabase URL
        # or if the kid isn't actually in the response.
        logger.error(f"JWKS Fetch Error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except jwt.exceptions.PyJWKError as e:
        # This triggers if the key format (EC/ES256) is not recognized
        logger.error(f"JWK Parsing Error (Check cryptography install): {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except PyJWTError as e:
        logger.error(f"General JWT Error: {e}")
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error during verification: {type(e).__name__} - {e}")
        raise HTTPException(status_code=401, detail=str(e))
