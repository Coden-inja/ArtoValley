// static/client.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- Configuration ---
const WS_URL = `ws://${window.location.host}/ws`;
const PLAYER_HEIGHT = 1.8;
const WALK_SPEED = 0.5; // Base speed
const RUN_SPEED = 0.9;
const JUMP_FORCE = 0.3;
const GRAVITY = -0.015;
const GROUND_HEIGHT = 1.0;
const RESPAWN_POSITION = new THREE.Vector3(200, GROUND_HEIGHT, 0);
const CAMERA_THIRD_PERSON_OFFSET = new THREE.Vector3(0, 2, 5);
const CAMERA_FIRST_PERSON_OFFSET = new THREE.Vector3(0, 1.6, 0);
const SEND_RATE = 100;

// Sound effects
const audioLoader = new THREE.AudioLoader();
const sounds = {
    background: new THREE.Audio(new THREE.AudioListener()),
    jump: new THREE.Audio(new THREE.AudioListener())
};
let isAudioInitialized = false;

// --- Global Variables ---
let scene, camera, renderer, clock, mixer, animations, actions;
let player, playerModel;
let controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, isRunning = false, isJumping = false;
let isThirdPerson = true;
let websocket;
let localPlayerId = null;
let otherPlayers = {};
let lastSendTime = 0;
let currentActionName = 'Idle';
let verticalVelocity = 0;
let isGrounded = true;
let isPointerLocked = false;

// Art pieces
const artPieces = [];
const artPiecePositions = [
    { x: 250, y: GROUND_HEIGHT + 1, z: 0 },    // Right of player
    { x: 150, y: GROUND_HEIGHT + 1, z: 0 },    // Left of player
    { x: 200, y: GROUND_HEIGHT + 1, z: 40 },   // Front of player
    { x: 200, y: GROUND_HEIGHT + 1, z: -50 }   // Back of player
];

// --- Initialization ---
function init() {
    // Scene, Camera, Renderer, Clock, Lights
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    renderer.domElement.addEventListener('click', () => {
        controls.lock();
    });

    clock = new THREE.Clock();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    scene.add(directionalLight);
    scene.add(directionalLight.target);

    // Player Object (Group for visuals)
    player = new THREE.Group();
    player.position.copy(RESPAWN_POSITION);
    scene.add(player);

    // --- Controls ---
    controls = new PointerLockControls(camera, document.body);
    const blocker = document.getElementById('info');
    controls.addEventListener('lock', () => blocker.style.display = 'none');
    controls.addEventListener('unlock', () => blocker.style.display = 'block');

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);

    // Pointer lock setup
    document.addEventListener('click', () => {
        if (!isPointerLocked) {
            renderer.domElement.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === renderer.domElement;
    });

    // Add mouse move event listener
    document.addEventListener('mousemove', handleMouseMove);

    // Load Models
    loadCityModel();
    loadPlayerModel().then(() => {
        connectWebSocket();
        animate();
    }).catch(error => {
        console.error("Failed to load player model:", error);
        updateStatus("Error loading player model", true);
    });

    // Load sounds
    audioLoader.load('sounds/background.mp3', 
        (buffer) => {
            console.log('Background music loaded successfully');
            sounds.background.setBuffer(buffer);
            sounds.background.setLoop(true);
            sounds.background.setVolume(0.3);
            // Don't play immediately, wait for user interaction
        },
        (xhr) => {
            console.log('Loading background music:', (xhr.loaded / xhr.total * 100) + '% loaded');
        },
        (error) => {
            console.error('Error loading background music:', error);
        }
    );

    audioLoader.load('sounds/jump.mp3', 
        (buffer) => {
            console.log('Jump sound loaded successfully');
            sounds.jump.setBuffer(buffer);
            sounds.jump.setVolume(0.7);
        },
        (xhr) => {
            console.log('Loading jump sound:', (xhr.loaded / xhr.total * 100) + '% loaded');
        },
        (error) => {
            console.error('Error loading jump sound:', error);
        }
    );

    // Load art pieces
    const artModels = [
        'models/Straw_Hat_Portrait_0408021708_texture.glb',
        'models/Girl_with_a_Pearl_Ear_0402012222_texture.glb',
        'models/leonardo3d.glb',
        'models/Mona_Lisa_Bust_Replic_0329150249_texture.glb'
    ];

    const artLoader = new GLTFLoader();
    artModels.forEach((modelPath, index) => {
        artLoader.load(modelPath, (gltf) => {
            const artPiece = gltf.scene;
            const position = artPiecePositions[index];
            
            // Position and scale the art piece
            artPiece.position.set(position.x, position.y, position.z);
            artPiece.scale.set(2, 2, 2); // Adjust scale as needed
            
            // Add to scene and artPieces array
            scene.add(artPiece);
            artPieces.push(artPiece);
        });
    });
}

// --- Model Loading ---
const loader = new GLTFLoader();

function loadCityModel() {
    loader.load('models/future_city_1.glb', (gltf) => {
        const city = gltf.scene;
        city.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });
        scene.add(city);
        console.log('City model loaded.');
    }, undefined, (error) => {
        console.error('Error loading city visual model:', error);
        updateStatus("Error loading city visuals", true);
    });
}

function loadPlayerModel() {
    return new Promise((resolve, reject) => {
        loader.load('models/Soldier.glb', (gltf) => {
            playerModel = gltf.scene;
            playerModel.scale.set(1, 1, 1);
            playerModel.traverse((node) => { if (node.isMesh) node.castShadow = true; });
            playerModel.position.y = -PLAYER_HEIGHT / 2;
            player.add(playerModel);

            animations = gltf.animations;
            mixer = new THREE.AnimationMixer(playerModel);
            actions = {};

            // --- DEBUG: Log available animation names ---
            console.log("Available animations in Soldier.glb:", animations.map(clip => clip.name));
            // ------------------------------------------

            // --- MODIFY this array based on the logged names ---
            const actionNames = ['Idle', 'Walk', 'Run']; // Current potentially incorrect names
            // Example: If logged names are 'idle_anim', 'walk_forward', 'run_fast'
            // You would change the line above to:
            // const actionNames = ['idle_anim', 'walk_forward', 'run_fast'];
            // --------------------------------------------------

            let foundIdle = false, foundWalk = false, foundRun = false; // Keep track

            actionNames.forEach(name => {
                const clip = THREE.AnimationClip.findByName(animations, name);
                if (clip) {
                    actions[name] = mixer.clipAction(clip);
                    console.log(`Found animation action: ${name}`);
                    // Check if we found one of the key types (adjust checks based on actual names)
                    if (name === actionNames[0]) foundIdle = true; // Assumes first name is Idle-like
                    if (name === actionNames[1]) foundWalk = true; // Assumes second name is Walk-like
                    if (name === actionNames[2]) foundRun = true;  // Assumes third name is Run-like
                } else {
                    // Don't log warning here yet, check after modifying actionNames
                }
            });

            // Now check if essential types were found using the *correct* names from actionNames
            if (!foundIdle || !foundWalk || !foundRun) {
                 // Log which specific types (based on your actionNames array) were missing
                 console.error(`Essential animations missing! Status: Idle=<span class="math-inline">\{foundIdle\}, Walk\=</span>{foundWalk}, Run=${foundRun}. Please check model and actionNames array.`);
                 // Log available names again to help debugging
                 console.error("Available animation names were:", animations.map(clip => clip.name));
                 reject("Missing essential animations based on names in actionNames array."); // Reject if any are missing
            } else {
                currentActionName = actionNames[0]; // Use the correct name for Idle
                if (actions[currentActionName]) {
                     actions[currentActionName].play();
                } else {
                     console.error("Could not play default idle animation using name: ", currentActionName);
                     // Optionally try playing the very first animation found as a fallback
                     if(animations.length > 0) {
                         const firstClipName = animations[0].name;
                         const fallbackAction = mixer.clipAction(animations[0]);
                         if (fallbackAction) {
                             actions[firstClipName] = fallbackAction; // Add it to actions
                             currentActionName = firstClipName;
                             fallbackAction.play();
                             console.warn("Playing first available animation as fallback: ", firstClipName);
                         }
                     }
                }
                console.log('Player model loaded.');
                resolve();
            }
        }, undefined, (error) => {
            console.error('Error loading player model GLB:', error); // Error loading the file itself
            reject(error);
        });
    });
}

// Function to load models for other players
function loadOtherPlayerModel(playerId, initialState) {
    // (Remains the same as user provided)
    loader.load('models/Soldier.glb', (gltf) => { /* ... */ }, undefined, (error) => console.error(`Error loading model for player ${playerId}:`, error));
}


// --- WebSocket Communication ---
function connectWebSocket() {
    updateStatus("Connecting to server..."); // Initial status
    websocket = new WebSocket(WS_URL);

    websocket.onopen = () => {
        console.log("WebSocket connection established.");
        // FIXED: Update status on successful connection
        updateStatus("Connected (Waiting for ID)");
    };

    websocket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            let needsStatusUpdate = false; // FIXED: Flag to update status display

            switch (message.type) {
                case 'yourId':
                    if (!localPlayerId) {
                        localPlayerId = message.id;
                        console.log("Assigned local player ID:", localPlayerId);
                        needsStatusUpdate = true; // FIXED
                    }
                    break;
                case 'initialState':
                    if (!localPlayerId) {
                        localPlayerId = message.yourId;
                        console.log("Assigned local player ID:", localPlayerId);
                        needsStatusUpdate = true; // FIXED
                    }
                    console.log("Receiving initial state for other players:", message.players);
                    message.players.forEach(p => { if (p.id !== localPlayerId && !otherPlayers[p.id]) { loadOtherPlayerModel(p.id, p); } });
                    if(localPlayerId) needsStatusUpdate = true; // FIXED: Update status after processing others too
                    break;
                 case 'playerJoined':
                    if (localPlayerId && message.id !== localPlayerId && !otherPlayers[message.id]) {
                         console.log("Player joined:", message.id);
                         loadOtherPlayerModel(message.id, message);
                         if(localPlayerId) needsStatusUpdate = true; // FIXED
                    }
                    break;
                 case 'playerLeft':
                     if (message.id !== localPlayerId && otherPlayers[message.id]) {
                         console.log("Player left:", message.id);
                         scene.remove(otherPlayers[message.id].model);
                         delete otherPlayers[message.id];
                         if(localPlayerId) needsStatusUpdate = true; // FIXED
                     }
                     break;
                 case 'updateState':
                     if (message.id !== localPlayerId && otherPlayers[message.id]) {
                         const other = otherPlayers[message.id];
                         if (message.position) other.model.position.set(message.position.x, message.position.y, message.position.z);
                         if (message.rotation) other.model.quaternion.set(message.rotation._x, message.rotation._y, message.rotation._z, message.rotation._w);
                         const receivedState = message.animationState || 'Idle';
                         if (other.currentState !== receivedState && other.actions[receivedState]) { /* ... animation update ... */ }
                         else if (other.actions[receivedState] && !other.actions[receivedState].isRunning()) { /* ... animation update ... */ }
                         else if (!other.actions[receivedState] && other.actions['Idle']) { /* ... fallback ... */ }
                     }
                     break;
                default:
                    if(message.id !== localPlayerId) { console.warn("Received unknown message type:", message.type); }
            }

            // FIXED: Update status text if needed and ID is known
            if (needsStatusUpdate && localPlayerId) {
                 const playerCount = 1 + Object.keys(otherPlayers).length;
                 // Show partial ID for brevity
                 updateStatus(`Connected (ID: ${localPlayerId.substring(0, 4)}..., Players: ${playerCount})`);
            }

        } catch (error) { console.error("Error processing message:", event.data, error); }
    };

    websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        updateStatus("WebSocket error", true);
    };

    websocket.onclose = () => {
        console.log("WebSocket connection closed.");
        updateStatus("Disconnected. Attempting to reconnect...", false);
        setTimeout(connectWebSocket, 5000);
        Object.keys(otherPlayers).forEach(id => { if (otherPlayers[id].model) scene.remove(otherPlayers[id].model); });
        otherPlayers = {};
        localPlayerId = null;
    };
}

function sendPlayerState() {
    // (Remains the same as user provided - sends physics body state)
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !localPlayerId) return;
    const now = Date.now();
    if (now - lastSendTime < SEND_RATE) return;
    lastSendTime = now;
    const state = { /* ... position/rotation from playerBody, animationState ... */ };
     state.type = 'updateState';
     state.position= { x: player.position.x, y: player.position.y, z: player.position.z };
     state.rotation= {
             _x: player.quaternion.x, _y: player.quaternion.y,
             _z: player.quaternion.z, _w: player.quaternion.w,
     };
     state.animationState= currentActionName;
    websocket.send(JSON.stringify(state));
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': 
            if (!isAudioInitialized) {
                sounds.background.play();
                isAudioInitialized = true;
            }
        moveForward = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward = true; break;
        case 'ArrowRight': case 'KeyD': moveRight = true; break;
        case 'ShiftLeft': case 'ShiftRight': isRunning = true; break;
        case 'Space': 
            if (isGrounded) { 
                isJumping = true; 
                verticalVelocity = JUMP_FORCE; 
                isGrounded = false;
                sounds.jump.play(); // Play jump sound
                if (!isAudioInitialized) {
                    sounds.background.play();
                    isAudioInitialized = true;
                }
            } 
            break;
        case 'KeyR': respawnPlayer(); break;
        case 'KeyC': isThirdPerson = !isThirdPerson; console.log("Camera toggled to:", isThirdPerson ? "Third Person" : "First Person"); break;
    }
}
function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': moveRight = false; break;
        case 'ShiftLeft': case 'ShiftRight': isRunning = false; break;
        case 'Space': 
            // Don't stop jumping on key up, let gravity handle it
            break;
    }
}

// --- Player Actions ---
function respawnPlayer() {
    // (Remains the same as user provided)
    if (!player) return;
    player.position.copy(RESPAWN_POSITION);
    if (controls.isLocked) { controls.unlock(); setTimeout(() => controls.lock(), 50); }
    updateCameraPosition();
    console.log("Player respawned.");
    lastSendTime = 0; sendPlayerState();
}

// --- Update Physics & Visuals ---

function handleMouseMove(event) {
    if (!player || !isPointerLocked) return;
    
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    
    if (isThirdPerson) {
        // Third person view - full 360 rotation
        // Rotate player horizontally
        player.rotation.y -= movementX * 0.002;
        
        // Calculate camera position based on player rotation
        const idealOffset = CAMERA_THIRD_PERSON_OFFSET.clone();
        const rotation = new THREE.Euler(0, player.rotation.y, 0, 'YXZ');
        const quaternion = new THREE.Quaternion().setFromEuler(rotation);
        idealOffset.applyQuaternion(quaternion);
        idealOffset.add(player.position);
        
        // Update camera position and rotation
        camera.position.lerp(idealOffset, 0.1);
        camera.lookAt(player.position);
        
        // Allow vertical camera rotation
        camera.rotation.x -= movementY * 0.002;
    } else {
        // First person view - full 360 rotation
        // Rotate player and camera horizontally
        player.rotation.y -= movementX * 0.002;
        camera.rotation.y -= movementX * 0.002;
        
        // Rotate camera vertically without limits
        camera.rotation.x -= movementY * 0.002;
        
        // Update camera position to maintain first person view
        camera.position.copy(player.position);
        camera.position.y += 1.6; // Eye height
        const forward = new THREE.Vector3(0, 0, -0.5);
        forward.applyQuaternion(camera.quaternion);
        camera.position.add(forward);
    }
}

function updatePlayerMovementAndAnimation(delta) {
    if (!player) return;

    const speed = isRunning ? RUN_SPEED : WALK_SPEED;
    const direction = new THREE.Vector3();
    const rotation = new THREE.Euler(0, player.rotation.y, 0, 'YXZ');
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);

    // Handle movement based on key states
    if (moveForward) direction.z -= 1;
    if (moveBackward) direction.z += 1;
    if (moveLeft) direction.x -= 1;
    if (moveRight) direction.x += 1;

    if (direction.length() > 0) {
        direction.normalize();
        direction.applyQuaternion(quaternion);
        
        // Update player position
        const newPosition = player.position.clone().add(direction.multiplyScalar(speed));
        player.position.copy(newPosition);
    }

    // Handle jumping
    if (isJumping) {
        player.position.y += verticalVelocity;
        verticalVelocity += GRAVITY;
        
        if (player.position.y <= GROUND_HEIGHT) {
            player.position.y = GROUND_HEIGHT;
            isJumping = false;
            verticalVelocity = 0;
            isGrounded = true;
        }
    } else if (player.position.y > GROUND_HEIGHT) {
        // If not jumping but above ground, apply gravity
        player.position.y += verticalVelocity;
        verticalVelocity += GRAVITY;
        
        if (player.position.y <= GROUND_HEIGHT) {
            player.position.y = GROUND_HEIGHT;
            verticalVelocity = 0;
            isGrounded = true;
        }
    }

    // Update animation based on movement and jumping
    let newActionName = 'Idle';
    if (isJumping || player.position.y > GROUND_HEIGHT) {
        // Stop all other animations during jump
        if (actions[currentActionName]) {
            actions[currentActionName].stop();
        }
    } else if (direction.length() > 0) {
        newActionName = isRunning ? 'Run' : 'Walk';
    }

    if (currentActionName !== newActionName && actions[newActionName]) {
        const oldAction = actions[currentActionName];
        const newAction = actions[newActionName];
        if (oldAction && oldAction.isRunning()) {
            oldAction.fadeOut(0.2);
        }
        newAction.reset().setEffectiveWeight(1.0).fadeIn(0.2).play();
        currentActionName = newActionName;
    }

    if (mixer) mixer.update(delta);
}

function updateCameraPosition() {
    if (!player || !camera) return;
    
    if (isThirdPerson) {
        // Third person view
        const idealOffset = CAMERA_THIRD_PERSON_OFFSET.clone();
        const rotation = new THREE.Euler(0, player.rotation.y, 0, 'YXZ');
        const quaternion = new THREE.Quaternion().setFromEuler(rotation);
        idealOffset.applyQuaternion(quaternion);
        idealOffset.add(player.position);
        camera.position.lerp(idealOffset, 0.1);
        camera.lookAt(player.position);
    } else {
        // First person view
        camera.position.copy(player.position);
        camera.position.y += 1.6; // Eye height
        const forward = new THREE.Vector3(0, 0, -0.5);
        forward.applyQuaternion(player.quaternion);
        camera.position.add(forward);
        camera.rotation.copy(player.rotation);
    }
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    // Rotate art pieces
    artPieces.forEach(artPiece => {
        artPiece.rotation.y += delta * 0.5; // Rotate at 0.5 radians per second
    });

    // Input + Animation
    updatePlayerMovementAndAnimation(delta);

    updateCameraPosition();

    Object.values(otherPlayers).forEach(other => {
        if (other.mixer) other.mixer.update(delta);
    });

    sendPlayerState();

    renderer.render(scene, camera);
}



// --- Utility ---
function updateStatus(message, isError = false) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = isError ? 'red' : 'lime';
    }
}

// --- Start ---
init();