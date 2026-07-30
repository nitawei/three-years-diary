import urllib.request
import json

def test_url(url):
    print(f"Testing URL: {url}")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            print("Status:", resp.status)
            print("Body:", resp.read().decode('utf-8'))
    except Exception as e:
        print("Exception:", type(e), e)

test_url("http://127.0.0.1:8080/")
test_url("http://127.0.0.1:8080/v1/projects/diary-1095/databases/(default)/documents")
