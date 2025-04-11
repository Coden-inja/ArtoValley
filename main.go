package main

import (
	"log"
	"net/http"
)

func main() {
	hub := newHub()
	go hub.run()

	// Serve static files (HTML, CSS, JS, Models)
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs) // Serve files from the static directory

	// Handle WebSocket connections
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	log.Println("Server starting on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}