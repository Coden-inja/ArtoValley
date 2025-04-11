package main

import "log"

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients. Maps client pointer to boolean true.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan []byte // Channel to broadcast messages to all clients

	// Register requests from the clients.
	register chan *Client // Channel to register a new client

	// Unregister requests from clients.
	unregister chan *Client // Channel to unregister a client
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

// Manages the hub's operations (registration, unregistration, broadcasting)
func (h *Hub) run() {
	log.Println("Hub running...")
	for {
		select {
		// Handle new client registration
		case client := <-h.register:
			h.clients[client] = true
			log.Printf("Client registered: %s. Total clients: %d\n", client.id, len(h.clients))
			// Optionally: Send initial state or notify others about the new client here

		// Handle client unregistration
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send) // Close the client's send channel
				log.Printf("Client unregistered: %s. Total clients: %d\n", client.id, len(h.clients))
				// Notify remaining clients that this player left
				disconnectMsg := []byte(`{"type":"playerLeft", "id":"` + client.id + `"}`)
				h.broadcastMessage(disconnectMsg, nil) // Broadcast to all remaining
			}

		// Handle broadcasting messages received from a client
		case message := <-h.broadcast:
			h.broadcastMessage(message, nil) // Broadcast to all clients
		}
	}
}

// Helper function to broadcast a message to clients
// Optionally excludes one client (e.g., the sender)
func (h *Hub) broadcastMessage(message []byte, exclude *Client) {
	for client := range h.clients {
		if client == exclude {
			continue // Don't send the message back to the sender if excluded
		}
		select {
		case client.send <- message:
			// Message sent successfully
		default:
			// Send buffer is full, client might be slow or disconnected
			log.Printf("Client %s send channel full or closed. Unregistering.", client.id)
			close(client.send)
			delete(h.clients, client)
			// Optionally: Send a playerLeft message for this client too
		}
	}
}