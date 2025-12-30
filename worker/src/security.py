import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt # PyJWT library

# Load trusted projects from an environment variable (comma-separated)
# SUPABASE_PROJECTS="project-a.supabase.co,project-b.supabase.co"
TRUSTED_DOMAINS = os.getenv("SUPABASE_PROJECTS", "").split(",")

security = HTTPBearer()

# We use a dictionary to cache JWK clients for each project
jwks_clients = {}

def get_jwks_client(domain: str):
    if domain not in jwks_clients:
        # Construct the standard Supabase JWKS URL
        url = f"https://{domain}/auth/v1/.well-known/jwks.json"
        jwks_clients[domain] = jwt.PyJWKClient(url)
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
            algorithms=["RS256"],
            audience="authenticated",
            issuer=issuer_url
        )
        return data

    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))
