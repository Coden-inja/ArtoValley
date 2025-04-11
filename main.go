package main

import (
	"log"
	"net/http"
	"os"
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

	port := os.Getenv("PORT")
         if port == "" {
             port = "8080" // Default port if not specified
         }

	log.Println("Server starting on :%s",port)
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}