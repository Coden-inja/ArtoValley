package main

import (
	"bytes"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid" // For generating unique IDs
	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 1024 // Increased size a bit for JSON data
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow connections from any origin (for development)
	// In production, you should restrict this to your frontend's origin.
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub *Hub

	// The websocket connection.
	conn *websocket.Conn

	// Buffered channel of outbound messages.
	send chan []byte

	// Unique ID for the client
	id string
}

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c // Unregister client when read fails
		c.conn.Close()
		log.Printf("Read pump stopped for client %s\n", c.id)
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait)) // Set initial read deadline
	c.conn.SetPongHandler(func(string) error {       // Handler for pong messages
		c.conn.SetReadDeadline(time.Now().Add(pongWait)) // Reset read deadline on pong
		return nil
	})
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error reading message for client %s: %v", c.id, err)
			} else {
				log.Printf("Client %s disconnected normally or read error: %v", c.id, err)
			}
			break // Exit loop on error
		}
		// Add client's ID to the message before broadcasting
		// Assuming incoming message is JSON like {"type":"update", "data":{...}}
		// We modify it to {"type":"update", "id":"clientID", "data":{...}}
		// This is a simple approach; more robust JSON handling is better for complex data
		message = bytes.Replace(message, []byte(`"type"`), []byte(`"id":"`+c.id+`","type"`), 1)

		c.hub.broadcast <- message // Send received message to the hub for broadcasting
	}
}

// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod) // Ticker for sending ping messages
	defer func() {
		ticker.Stop() // Stop ticker when write fails
		c.conn.Close()
		log.Printf("Write pump stopped for client %s\n", c.id)
		// No need to unregister here, readPump handles it usually
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait)) // Set deadline for writing
			if !ok {
				// The hub closed the channel.
				log.Printf("Hub closed channel for client %s\n", c.id)
				c.conn.WriteMessage(websocket.CloseMessage, []byte{}) // Send close message
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				log.Printf("Error getting next writer for client %s: %v\n", c.id, err)
				return // Exit loop on error
			}
			_, err = w.Write(message)
			if err != nil {
				log.Printf("Error writing message for client %s: %v\n", c.id, err)
				// Don't return immediately, try closing writer
			}

			// Add queued chat messages to the current websocket message.
			// This part is less relevant for state updates but good for chat example.
			// n := len(c.send)
			// for i := 0; i < n; i++ {
			//  w.Write([]byte{'\n'}) // Separator if needed
			// 	w.Write(<-c.send)
			// }

			if err := w.Close(); err != nil {
				log.Printf("Error closing writer for client %s: %v\n", c.id, err)
				return // Exit loop on error
			}
		case <-ticker.C: // Send a ping message periodically
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Error writing ping for client %s: %v\n", c.id, err)
				return // Exit loop on error
			}
		}
	}
}

// serveWs handles websocket requests from the peer.
func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil) // Upgrade HTTP connection to WebSocket
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	// Generate a unique ID for the client
	clientID := uuid.New().String()

	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256), id: clientID}
	client.hub.register <- client // Register the client with the hub

	// Send the client its unique ID
	idMsg := []byte(`{"type":"yourId", "id":"` + client.id + `"}`)
	client.send <- idMsg

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump() // Start writing messages to the client
	go client.readPump()  // Start reading messages from the client

	log.Printf("WebSocket connection established for client %s\n", client.id)
}