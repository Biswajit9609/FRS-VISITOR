# Camera + Raspberry Pi Zero 2 W + Cloud Architecture

> **Architecture:** Wi-Fi IP Camera → Raspberry Pi Zero 2 W → Secure Internet Connection → Cloud → AWS Rekognition → PostgreSQL/Object Storage → Dashboard
>
> **Design goal:** One low-cost Raspberry Pi Zero 2 W per camera. No GPU, no custom ML model, and no face-recognition processing on the Raspberry Pi.

---

## 1. Architecture Overview

```mermaid
flowchart LR
    subgraph SITE["Apartment / PG"]
        CAM["AI IP Camera<br/>RTSP + ONVIF + Person Detection"]
        PI["Raspberry Pi Zero 2 W<br/>Camera Gateway"]
        ROUTER["Wi-Fi Router / Internet"]

        CAM -->|"RTSP / ONVIF<br/>Local LAN"| PI
        PI -->|"Wi-Fi / Ethernet<br/>Outbound HTTPS / VPN"| ROUTER
    end

    subgraph CLOUD["Cloud"]
        GW["Cloud Gateway API"]
        WORKER["Camera Processing Service"]
        FACE["AWS Rekognition"]
        DB[("PostgreSQL")]
        STORAGE["Object Storage"]
        API["Backend API"]
        DASH["React Dashboard"]

        GW --> WORKER
        WORKER --> FACE
        WORKER --> DB
        WORKER --> STORAGE
        API --> DB
        API --> STORAGE
        DASH --> API
    end

    ROUTER -->|"Internet"| GW
```

---

# 2. Core Design Principle

The Raspberry Pi is **not an AI/ML computer**.

Its job is only to act as a **camera gateway**.

```text
Camera
   │
   │ RTSP
   │ ONVIF
   ▼
Raspberry Pi
   │
   ├── Camera communication
   ├── Person-event handling
   ├── Frame/snapshot capture
   ├── Local buffering
   ├── Connection management
   └── Secure cloud communication
   │
   ▼
Cloud
   │
   ├── Face recognition
   ├── Business logic
   ├── Database
   ├── Storage
   └── Dashboard
```

The Pi does **not** run:

* YOLO
* ArcFace
* SCRFD
* MobileFaceNet
* custom face recognition
* model training
* GPU inference

Face identification is handled by **AWS Rekognition**.

---

# 3. Hardware Per Camera

Each camera installation consists of:

```text
┌─────────────────────────┐
│ AI IP Camera            │
│                         │
│ • Wi-Fi                 │
│ • RTSP                  │
│ • ONVIF                 │
│ • Person Detection      │
└────────────┬────────────┘
             │
          Wi-Fi/LAN
             │
             ▼
┌─────────────────────────┐
│ Raspberry Pi Zero 2 W   │
│                         │
│ • Camera Gateway Agent  │
│ • RTSP Client           │
│ • ONVIF Client          │
│ • Event Handler         │
│ • Frame Capture         │
│ • Local Queue           │
│ • Cloud Connector       │
└────────────┬────────────┘
             │
          Internet
             │
             ▼
          CLOUD
```

---

# 4. Camera Requirements

The camera must provide:

| Requirement               | Required  |
| ------------------------- | --------- |
| Wi-Fi                     | Yes       |
| RTSP                      | Yes       |
| ONVIF                     | Yes       |
| Built-in person detection | Yes       |
| 1080p minimum             | Yes       |
| H.264                     | Preferred |
| Night vision              | Yes       |
| 24/7 operation            | Yes       |
| Local network operation   | Yes       |
| MicroSD                   | Preferred |

The previously researched **Tapo C320WS** remains the primary camera candidate because it provides 4MP video, Wi-Fi, RTSP, ONVIF and built-in person detection within the ₹5,000 camera budget. The research document lists it at approximately ₹3,600. 

---

# 5. Raspberry Pi Zero 2 W

Each camera gets its own Pi.

### Recommended specification

```text
Raspberry Pi Zero 2 W
512 MB RAM
Wi-Fi
Bluetooth
microSD
5V power
```

The Pi should run:

```text
Raspberry Pi OS Lite 64-bit
```

or another lightweight Linux distribution.

No desktop environment is required.

---

# 6. Why One Pi Per Camera?

Instead of:

```text
Camera 1 ─┐
Camera 2 ─┼── N100
Camera 3 ─┤
Camera 4 ─┘
```

we use:

```text
Camera 1 ── Pi 1
Camera 2 ── Pi 2
Camera 3 ── Pi 3
Camera 4 ── Pi 4
```

This gives each camera an independent gateway.

Advantages:

* simple deployment
* simple camera configuration
* independent failure isolation
* easy replacement
* easy scaling
* no centralized edge bottleneck
* adding a camera means adding one gateway

---

# 7. Local Network Architecture

The camera and Pi should be on the same local network.

Example:

```text
Router
│
├── Camera
│   192.168.1.50
│
└── Raspberry Pi
    192.168.1.51
```

The Pi communicates with the camera locally.

```text
Pi
 │
 ├──── RTSP ────► Camera
 │
 └──── ONVIF ───► Camera
```

No camera RTSP port needs to be exposed directly to the internet.

---

# 8. RTSP Communication

RTSP is used for the **video stream**.

Example:

```text
rtsp://username:password@192.168.1.50:554/stream1
```

The Pi connects to the camera's RTSP server.

```text
Camera
   │
   │ H.264 video
   ▼
Raspberry Pi
```

The Pi can use:

```text
FFmpeg
```

or:

```text
GStreamer
```

for RTSP handling.

For this project, FFmpeg is sufficient.

---

# 9. ONVIF Communication

ONVIF is used for standardized camera communication.

The Pi can use ONVIF to:

* discover the camera
* obtain camera information
* obtain stream information
* access camera capabilities
* communicate with supported event services
* obtain snapshot information where supported

Conceptually:

```text
Pi
 │
 │ ONVIF
 ▼
Camera
 │
 ├── Device information
 ├── Profiles
 ├── Stream URI
 ├── Snapshot URI
 └── Events
```

The exact event capabilities depend on the camera's ONVIF implementation.

---

# 10. Person Detection

The camera performs the first-level detection.

```text
Camera
   │
   │ Built-in AI
   ▼
Person detected
```

We do **not** run YOLO on the Raspberry Pi.

The goal is:

```text
Camera AI
    ↓
Person detected
    ↓
Pi receives/handles event
    ↓
Capture suitable frame
```

The original client architecture similarly specifies camera/RTSP input followed by person detection and then face processing. 

---

# 11. Raspberry Pi Gateway Agent

The Pi runs one lightweight service:

```text
camera-gateway
```

Suggested implementation:

```text
Python
├── asyncio
├── ONVIF client
├── FFmpeg subprocess
├── HTTP client
├── local SQLite
└── systemd
```

Directory structure:

```text
/opt/camera-gateway/

├── app/
│   ├── main.py
│   ├── camera.py
│   ├── rtsp.py
│   ├── onvif.py
│   ├── events.py
│   ├── capture.py
│   ├── uploader.py
│   ├── queue.py
│   └── health.py
│
├── config/
│   └── config.json
│
├── data/
│   └── queue.db
│
└── logs/
```

---

# 12. Pi Configuration

The Pi should have a unique device ID.

Example:

```json
{
  "device_id": "EDGE-00001",
  "camera_id": "CAM-00001"
}
```

The cloud associates:

```text
EDGE-00001
        ↓
CAM-00001
        ↓
Main Entrance
```

---

# 13. Cloud Communication

The Pi should establish an **outbound secure connection** to the cloud.

Preferred:

```text
Pi
 │
 │ HTTPS/TLS
 ▼
Cloud API
```

For real-time communication:

```text
Pi
 │
 │ WebSocket / MQTT
 ▼
Cloud
```

A simple implementation can use HTTPS polling + REST APIs initially.

For production, I would use:

```text
HTTPS
+
WebSocket
```

---

# 14. Why Outbound Communication?

The Pi is inside the apartment/PG network.

We don't want:

```text
Internet
   ↓
Pi
```

with an exposed public port.

Instead:

```text
Pi
 │
 │ outbound HTTPS
 ▼
Cloud
```

This works naturally through normal NAT.

The router doesn't need to expose the Pi to the internet.

---

# 15. Recommended Connectivity

```text
Camera
   │
   │ Local Wi-Fi
   ▼
Raspberry Pi
   │
   │ Outbound HTTPS/TLS
   │
   ▼
Internet
   │
   ▼
Cloud API
```

No:

```text
Internet → Camera
```

No:

```text
Internet → Pi
```

---

# 16. Optional WireGuard

For administration and private networking, WireGuard can be added.

```text
Pi
 │
 │ WireGuard
 ▼
Cloud VPN
```

Then the cloud can securely reach the Pi when required.

However, normal event communication can still use HTTPS.

Recommended:

```text
Event/data:
HTTPS

Administrative/private access:
WireGuard
```

---

# 17. Camera Event Flow

The normal flow is:

```text
Camera
   │
   │ Person detected
   ▼
Pi
   │
   │ Event validation/debounce
   ▼
Capture frame
   │
   ▼
Cloud
```

The Pi should prevent duplicate processing.

For example:

```text
Person detected
      ↓
Start event
      ↓
Capture 3–5 frames
      ↓
Select best frame
      ↓
Send event
      ↓
Cooldown
      ↓
Wait for next person
```

---

# 18. Frame Capture

The Pi does not continuously upload 30 FPS video.

Instead:

```text
RTSP stream
     │
     ▼
Pi
     │
     ├── Person event
     │
     ▼
Capture burst
     │
     ├── Frame 1
     ├── Frame 2
     ├── Frame 3
     ├── Frame 4
     └── Frame 5
```

The best frame is selected based on simple image-quality metrics such as:

* sharpness
* brightness
* face visibility
* frame quality

No custom ML model is required for this step.

---

# 19. Cloud Event API

The Pi sends an event to:

```text
POST /api/v1/edge/events
```

Example:

```json
{
  "device_id": "EDGE-00001",
  "camera_id": "CAM-00001",
  "event_id": "evt_8f32a1",
  "event_type": "PERSON_DETECTED",
  "captured_at": "2026-08-11T15:30:12+05:30",
  "image": "<multipart-upload>"
}
```

The backend authenticates the device before accepting the event.

---

# 20. Cloud Processing

After receiving the image:

```text
Cloud
  │
  ▼
Validate event
  │
  ▼
Store temporary image
  │
  ▼
AWS Rekognition
  │
  ▼
Match resident
```

AWS Rekognition handles the actual face recognition.

---

# 21. Resident Enrollment

Admin dashboard:

```text
Add Resident

Name:
Rahul

Room:
203

Photos:
[Upload]
[Upload]
[Upload]

[Enroll]
```

Recommended:

```text
3–5 images/resident
```

The original SRS specifies 3–5 images per resident. 

Backend:

```text
Resident
   ↓
AWS Rekognition collection
   ↓
Face/User ID
   ↓
Database
```

---

# 22. Known Visitor Flow

```mermaid
sequenceDiagram
    participant C as Camera
    participant P as Raspberry Pi
    participant B as Cloud Backend
    participant R as AWS Rekognition
    participant D as PostgreSQL
    participant U as Dashboard

    C->>P: Person detected
    P->>C: Capture frame via RTSP
    C-->>P: Frame
    P->>B: Upload event + image
    B->>R: Search resident face
    R-->>B: Resident match + confidence
    B->>D: Store visitor event
    B-->>U: New known visitor
```

---

# 23. Unknown Visitor Flow

```mermaid
sequenceDiagram
    participant C as Camera
    participant P as Raspberry Pi
    participant B as Cloud Backend
    participant R as AWS Rekognition
    participant S as Object Storage
    participant D as PostgreSQL
    participant U as Dashboard

    C->>P: Person detected
    P->>C: Capture frame via RTSP
    C-->>P: Frame
    P->>B: Upload event + image
    B->>R: Search resident face
    R-->>B: No resident match
    B->>S: Store representative image
    B->>D: Create unknown visitor + event
    B-->>U: New unknown visitor
```

---

# 24. Unknown Visitor Deduplication

The system should distinguish between:

```text
Unknown Person
```

and:

```text
Visitor Event
```

Example:

```text
Unknown #102

First Seen:
10:32 AM

Last Seen:
12:48 PM

Occurrences:
4
```

Database:

```text
UNKNOWN_VISITOR
        │
        ├── first_seen
        ├── last_seen
        ├── occurrence_count
        └── representative_image

VISITOR_EVENT
        │
        ├── timestamp
        ├── camera
        └── unknown_visitor_id
```

The original client architecture also calls for deduplicating repeated appearances of the same unknown visitor. 

---

# 25. Local Queue on Raspberry Pi

If the internet temporarily disappears:

```text
Camera
   ↓
Pi
   ↓
Local Queue
```

The Pi stores:

```text
event_id
timestamp
camera_id
image_path
upload_status
retry_count
```

When connectivity returns:

```text
Local Queue
     ↓
Cloud
     ↓
Success
     ↓
Delete local copy
```

This prevents short network failures from immediately losing events.

---

# 26. Pi Health Monitoring

Every Pi sends a heartbeat:

```text
POST /api/v1/edge/heartbeat
```

Example:

```json
{
  "device_id": "EDGE-00001",
  "camera_id": "CAM-00001",
  "status": "ONLINE",
  "uptime": 483921,
  "queue_size": 0,
  "camera_connected": true,
  "rtsp_connected": true,
  "last_event_at": "2026-08-11T15:31:20+05:30"
}
```

Dashboard:

```text
Camera 01
● Online

Gateway
● Online

RTSP
● Connected

Last Event
15:31:20
```

---

# 27. Dynamic Camera Addition

This is one of the most important requirements.

Admin:

```text
Cameras
─────────────────────────

Entrance Camera
● Online

[ + Add Camera ]
```

Admin enters:

```text
Camera Name
Location
RTSP URL
Camera Username
Camera Password
```

The backend generates/provides:

```text
camera_id
device_id
configuration
```

The Pi receives its configuration.

```text
Cloud
  ↓
Camera configuration
  ↓
Pi
  ↓
Connect RTSP
  ↓
Connect ONVIF
  ↓
Camera online
```

No code modification.

---

# 28. Device Provisioning

Each Raspberry Pi should have a unique provisioning token.

First boot:

```text
Pi
 ↓
POST /api/v1/edge/register
 ↓
Cloud
 ↓
Validate provisioning token
 ↓
Create edge device
 ↓
Return device credentials
```

After provisioning:

```text
device_id
device_secret
camera_id
configuration
```

are stored securely on the Pi.

---

# 29. Security Model

### Camera

```text
Camera
 ↓
Private LAN
```

No public RTSP.

### Raspberry Pi

```text
Pi
 ↓
Outbound HTTPS
 ↓
Cloud
```

### Cloud

```text
HTTPS
TLS
JWT/device authentication
RBAC
```

### Device authentication

Each Pi should have its own credential.

Do not use:

```text
ONE API KEY FOR ALL PIS
```

Use:

```text
EDGE-00001 → credential A
EDGE-00002 → credential B
EDGE-00003 → credential C
```

If one device is compromised, revoke only that device.

---

# 30. Cloud Architecture

```mermaid
flowchart TB
    subgraph SITE1["Property / Site"]
        C1["Camera 1"]
        P1["Pi Zero 2 W 1"]
        C1 -->|"RTSP / ONVIF"| P1
    end

    subgraph SITE2["Property / Site"]
        C2["Camera 2"]
        P2["Pi Zero 2 W 2"]
        C2 -->|"RTSP / ONVIF"| P2
    end

    P1 -->|"HTTPS / WebSocket"| ING["Cloud Gateway"]
    P2 -->|"HTTPS / WebSocket"| ING

    ING --> WORKER["Event Processing"]
    WORKER --> FACE["AWS Rekognition"]
    WORKER --> DB[("PostgreSQL")]
    WORKER --> STORAGE["Object Storage"]

    API["Backend API"] --> DB
    API --> STORAGE

    DASH["React Dashboard"] --> API
```

---

# 31. Cloud Components

### Cloud VM

```text
2 vCPU
4 GB RAM
40–60 GB SSD
Linux
Docker
```

Services:

```text
Nginx
Backend API
Camera Gateway API
Worker
WebSocket service
```

---

### PostgreSQL

Stores:

```text
residents
faces
cameras
edge_devices
visitor_events
unknown_visitors
audit_logs
```

---

### Object Storage

Stores:

```text
resident images
unknown visitor images
temporary event images
```

Images should not be stored directly inside PostgreSQL.

---

# 32. Recommended Database Structure

```text
PROPERTY
    │
    ├── CAMERAS
    │       │
    │       └── EDGE_DEVICE
    │
    └── RESIDENTS
            │
            └── RESIDENT_FACES

CAMERA
    │
    └── VISITOR_EVENTS
             │
             ├── RESIDENT
             │
             └── UNKNOWN_VISITOR
```

---

# 33. Dashboard

### Overview

```text
┌─────────────────────────────────────┐
│ Today's Visitors                    │
│                                     │
│  Total       Known       Unknown    │
│   128          96           32      │
└─────────────────────────────────────┘
```

### Cameras

```text
┌──────────────────┐
│ Main Entrance    │
│ ● Online         │
│                  │
│ Last Event       │
│ 15:31:20         │
└──────────────────┘
```

### Known Visitors

```text
Rahul
Room 203
15:31:20
Confidence: 96.4%

Amit
Room 104
15:28:42
Confidence: 94.8%
```

### Unknown Visitors

```text
┌─────────┐
│  FACE   │
└─────────┘
Unknown #102
15:24:12

┌─────────┐
│  FACE   │
└─────────┘
Unknown #103
15:20:41
```

---

# 34. Camera Management

```text
Camera Management

┌───────────────────────────────────────┐
│ Main Entrance                         │
│ Camera: CAM-001                       │
│ Gateway: EDGE-001                     │
│ ● Online                              │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│ Back Entrance                         │
│ Camera: CAM-002                       │
│ Gateway: EDGE-002                     │
│ ● Online                              │
└───────────────────────────────────────┘

              [+ Add Camera]
```

---

# 35. Resident Management

```text
Residents

Rahul
Room 203
3 enrolled images
● Active

Amit
Room 104
5 enrolled images
● Active

                [+ Add Resident]
```

---

# 36. API Structure

### Device APIs

```text
POST /api/v1/edge/register
POST /api/v1/edge/heartbeat
GET  /api/v1/edge/config
POST /api/v1/edge/events
POST /api/v1/edge/events/batch
```

### Camera APIs

```text
GET    /api/v1/cameras
POST   /api/v1/cameras
GET    /api/v1/cameras/:id
PATCH  /api/v1/cameras/:id
DELETE /api/v1/cameras/:id
POST   /api/v1/cameras/:id/test
```

### Resident APIs

```text
GET    /api/v1/residents
POST   /api/v1/residents
GET    /api/v1/residents/:id
PATCH  /api/v1/residents/:id
DELETE /api/v1/residents/:id
POST   /api/v1/residents/:id/faces
```

### Visitor APIs

```text
GET /api/v1/visitors
GET /api/v1/visitors/known
GET /api/v1/visitors/unknown
GET /api/v1/visitors/:id
```

---

# 37. Event Processing Pipeline

```text
PERSON_DETECTED
       │
       ▼
Create event session
       │
       ▼
Capture frames
       │
       ▼
Select best frame
       │
       ▼
Upload to cloud
       │
       ▼
AWS Rekognition
       │
       ▼
Confidence evaluation
       │
   ┌───┴────┐
   │        │
Known    Unknown
   │        │
   ▼        ▼
Resident  Unknown
event     visitor
   │        │
   └───┬────┘
       ▼
PostgreSQL
       │
       ▼
Dashboard
```

---

# 38. Event Deduplication

A single person shouldn't generate hundreds of events.

Use a camera-level cooldown/session.

Example:

```text
Person detected
      ↓
Session started
      ↓
Process person
      ↓
Ignore same track/session for N seconds
      ↓
Session ended
```

Example:

```text
10:32:10  detected
10:32:11  ignored
10:32:12  ignored
10:32:13  ignored
10:32:14  session completed
```

One visitor event is created.

---

# 39. Cloud-to-Pi Commands

The cloud should also be able to send commands to the gateway.

For example:

```text
restart_camera_connection
refresh_configuration
restart_gateway
capture_test_frame
update_settings
```

Communication:

```text
Cloud
   │
   │ WebSocket
   ▼
Pi
```

Example:

```json
{
  "command": "capture_test_frame",
  "camera_id": "CAM-001"
}
```

The Pi executes the command and responds:

```json
{
  "success": true,
  "image_url": "..."
}
```

---

# 40. Software Update Architecture

The Pi should support remote updates.

```text
Cloud
 ↓
New gateway version
 ↓
Pi
 ↓
Download
 ↓
Verify
 ↓
Install
 ↓
Restart
```

Docker can be used if the Zero 2 W's resource constraints remain acceptable.

For the first version, a lightweight Python service managed by `systemd` may be simpler and more resource-efficient.

---

# 41. Failure Handling

### Camera disconnected

```text
Pi
 ↓
RTSP connection lost
 ↓
Retry
 ↓
Retry
 ↓
Camera reconnected
```

### Internet disconnected

```text
Pi
 ↓
Local queue
 ↓
Internet restored
 ↓
Upload pending events
```

### Cloud unavailable

```text
Pi
 ↓
Queue events
 ↓
Retry with exponential backoff
```

### AWS unavailable

```text
Cloud
 ↓
Retry
 ↓
Temporary event state
 ↓
Process when API recovers
```

---

# 42. Monitoring

Dashboard should show:

```text
Camera status
Gateway status
RTSP status
Last heartbeat
Last visitor event
Queue size
Cloud connectivity
AWS API errors
```

Example:

```text
CAM-001
──────────────
Camera       ● Online
Gateway      ● Online
RTSP         ● Connected
Cloud        ● Connected
Last event   15:31:20
Queue        0
```

---

# 43. Security

### Camera

* strong password
* private LAN
* no public RTSP
* disable unnecessary services

### Raspberry Pi

* SSH disabled or restricted
* key-based authentication
* unique device credentials
* encrypted storage where appropriate
* automatic security updates
* firewall enabled

### Cloud

* HTTPS/TLS
* authentication
* RBAC
* encrypted database
* private object storage
* signed image URLs
* audit logging

---

# 44. Data Retention

Recommended configurable policies:

```text
Resident face images
→ retain while resident is active

Unknown visitor images
→ configurable, e.g. 30/60/90 days

Event metadata
→ configurable

Temporary Pi images
→ delete after successful upload

Failed upload queue
→ retain until successful or expiry
```

The original SRS also calls for data minimization and configurable retention of unknown visitor images. 

---

# 45. Cost Structure

### Per camera

```text
Camera
₹2,500–₹4,000 approximately

Raspberry Pi Zero 2 W
₹1,500–₹2,500 approximately

Power supply
₹300–₹500

microSD / storage
₹300–₹700
```

Approximate gateway hardware:

```text
₹2,100–₹3,700
```

excluding the camera.

### One complete installation

```text
Camera              ₹2,500–₹4,000
Pi Zero 2 W          ₹1,000–₹1,500
Power + storage        ₹600–₹1,200
--------------------------------
Total                ₹4,100–₹6,700
```

---

# 46. Cloud Cost

The cloud consists primarily of:

```text
Cloud VM
PostgreSQL
Object storage
Network
AWS Rekognition
```

The original research estimates approximately ₹2–4K/month at the initial scale, with the exact amount depending on API usage and infrastructure selection. 

The face-recognition workload is small at approximately:

```text
300 person events/day
≈ 9,000 events/month
```

and should remain relatively inexpensive compared with continuously processing full video.

---

# 47. Deployment Model

Each installation:

```text
Camera
   +
Pi Zero 2 W
```

gets a unique identity:

```text
SITE-001
  │
  ├── CAM-001
  │      └── EDGE-001
  │
  ├── CAM-002
  │      └── EDGE-002
  │
  └── CAM-003
         └── EDGE-003
```

Cloud:

```text
Global Backend
     │
     ├── Site 001
     ├── Site 002
     └── Site N
```

This allows the same software platform to support multiple properties later.

---

# 48. Complete End-to-End Flow

```mermaid
sequenceDiagram
    participant C as AI Camera
    participant P as Raspberry Pi Zero 2 W
    participant G as Cloud Gateway
    participant F as AWS Rekognition
    participant D as PostgreSQL
    participant S as Object Storage
    participant U as Dashboard

    C->>P: Person detected
    P->>C: Request/capture frame via RTSP
    C-->>P: Video frame
    P->>P: Select suitable frame
    P->>G: Upload event + image
    G->>F: Search resident face
    F-->>G: Match / no match + confidence

    alt Known resident
        G->>D: Store known visitor event
    else Unknown visitor
        G->>S: Store representative face image
        G->>D: Store unknown visitor + event
    end

    G->>U: Publish new visitor event
```

---

# 49. Final Architecture

```text
                         ┌────────────────────────────┐
                         │       React Dashboard      │
                         └──────────────┬─────────────┘
                                        │
                                      HTTPS
                                        │
                         ┌──────────────▼─────────────┐
                         │        Backend API         │
                         │                            │
                         │ Auth / RBAC                 │
                         │ Camera Management           │
                         │ Resident Management         │
                         │ Visitor Management          │
                         │ Device Management           │
                         └──────────────┬─────────────┘
                                        │
                    ┌───────────────────┼──────────────────┐
                    │                   │                  │
                    ▼                   ▼                  ▼
              PostgreSQL          Object Storage     AWS Rekognition
                    ▲                   ▲                  ▲
                    │                   │                  │
                    └───────────┬───────┴──────────────────┘
                                │
                         Event Processing
                                │
                         Cloud Gateway
                                │
                     HTTPS / WebSocket / VPN
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
              ▼                 ▼                  ▼
          Raspberry Pi      Raspberry Pi       Raspberry Pi
           Zero 2 W           Zero 2 W           Zero 2 W
              │                 │                  │
             RTSP              RTSP               RTSP
             ONVIF             ONVIF              ONVIF
              │                 │                  │
              ▼                 ▼                  ▼
          Camera 01          Camera 02          Camera 03
```

## Final technology choices

| Layer                    | Technology                                        |
| ------------------------ | ------------------------------------------------- |
| Camera                   | AI IP camera with RTSP + ONVIF + person detection |
| Edge hardware            | **Raspberry Pi Zero 2 W — one per camera**        |
| Edge OS                  | Raspberry Pi OS Lite                              |
| Camera protocol          | RTSP                                              |
| Camera management/events | ONVIF                                             |
| Edge agent               | Python                                            |
| Video utility            | FFmpeg                                            |
| Edge → Cloud             | HTTPS/TLS                                         |
| Optional private network | WireGuard                                         |
| Backend                  | FastAPI / Django                                  |
| Face recognition         | **AWS Rekognition**                               |
| Database                 | PostgreSQL                                        |
| Image storage            | S3 / GCS                                          |
| Frontend                 | React                                             |
| Authentication           | JWT/session + RBAC                                |
| Monitoring               | Cloud monitoring + gateway heartbeat              |
| ML training              | **None**                                          |
| GPU                      | **None**                                          |
| Edge ML                  | **None**                                          |
| Cloud VM                 | 2 vCPU / 4 GB starting point                      |

**In short:**

> **Camera does person detection → Raspberry Pi handles camera connectivity, RTSP/ONVIF, event capture and secure cloud communication → Cloud handles business logic → AWS Rekognition identifies the person → PostgreSQL/storage records everything → React dashboard displays it.**

This keeps the per-camera hardware inexpensive while making the cloud the central brain of the entire system.
