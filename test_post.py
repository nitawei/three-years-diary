import urllib.request
import json

project_id = "three-years-diary"

def test_post():
    url = f"http://127.0.0.1:8080/v1/projects/{project_id}/databases/(default)/documents/users/realtime-test-user-a/partner?documentId=info"
    data = json.dumps({
        "fields": {
            "partnerId": {"stringValue": "realtime-test-user-b"},
            "connectedAt": {"stringValue": "2026-07-30T00:00:00.000Z"}
        }
    }).encode('utf-8')
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer owner'
    }
    
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as resp:
            print("POST Status:", resp.status)
            print("Response:", resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print("POST HTTPError:", e.code, e.read().decode('utf-8'))
    except Exception as e:
        print("POST Exception:", e)

test_post()
