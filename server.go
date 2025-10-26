package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/andygrunwald/go-jira"
)

const (
	// Directory where JSON files are stored
	dataDir = "./data"
	// Server port
	port = 8080
	// Directory where backups are stored
	backupDir = "./data/backups"
	// Default max number of backups to keep
	defaultMaxBackups = 10
)

func main() {
	// Create log file
	logFile, err := os.OpenFile("server.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatal("Failed to open log file:", err)
	}
	defer logFile.Close()

	// Set log output to both file and console
	log.SetOutput(io.MultiWriter(os.Stdout, logFile))

	// Create data directory if it doesn't exist
	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			log.Fatalf("Failed to create data directory: %v", err)
		}
	}

	// Create backup directory if it doesn't exist
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		if err := os.MkdirAll(backupDir, 0755); err != nil {
			log.Printf("Creating backup directory: %s", backupDir)
			if err := os.MkdirAll(backupDir, 0755); err != nil {
				log.Fatalf("Failed to create backup directory: %v", err)
			}
		}
	}

	// File server for static files (HTML, CSS, JS)
	fs := http.FileServer(http.Dir("./static"))

	// Register handlers
	http.Handle("/", fs)
	http.HandleFunc("/api/environments.json", handleEmployees)
	http.HandleFunc("/api/releases.json", handleDaysOff)
	http.HandleFunc("/api/holidays.json", handleHolidays)
	http.HandleFunc("/api/jira-tickets", handleJiraTickets)

	// Add new handlers for backup management
	http.HandleFunc("/api/backups", handleBackups)
	http.HandleFunc("/api/backup-settings", handleBackupSettings)

	// Setup logger middleware
	loggedRouter := logMiddleware(http.DefaultServeMux)

	// Start the server
	serverAddr := fmt.Sprintf(":%d", port)
	log.Printf("Starting server on %s", serverAddr)
	log.Fatal(http.ListenAndServe(serverAddr, loggedRouter))
}

// Logger middleware
func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.RequestURI, time.Since(start))
	})
}

// Handle environments.json
func handleEmployees(w http.ResponseWriter, r *http.Request) {
	filePath := filepath.Join(dataDir, "environments.json")

	switch r.Method {
	case http.MethodGet:
		serveJSONFile(w, filePath)
	case http.MethodPost:
		// Align with other endpoints: create versioned backups in backupDir
		maxBackupsStr := r.Header.Get("X-Max-Backups")
		maxBackups := defaultMaxBackups
		if maxBackupsStr != "" {
			if val, err := strconv.Atoi(maxBackupsStr); err == nil && val > 0 {
				maxBackups = val
			}
		}
		updateJSONFileWithBackup(w, r, filePath, maxBackups)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Handle releases.json
func handleDaysOff(w http.ResponseWriter, r *http.Request) {
	filePath := filepath.Join(dataDir, "releases.json")

	switch r.Method {
	case http.MethodGet:
		serveJSONFile(w, filePath)
	case http.MethodPost:
		// Parse max backups from the request header
		maxBackupsStr := r.Header.Get("X-Max-Backups")
		maxBackups := defaultMaxBackups
		if maxBackupsStr != "" {
			if val, err := strconv.Atoi(maxBackupsStr); err == nil && val > 0 {
				maxBackups = val
			}
		}
		updateJSONFileWithBackup(w, r, filePath, maxBackups)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Handle Jira tickets API
func handleJiraTickets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read Jira config
	configPath := filepath.Join(dataDir, "jira-config.json")
	configData, err := os.ReadFile(configPath)
	if err != nil {
		http.Error(w, "Failed to read Jira config", http.StatusInternalServerError)
		return
	}

	var config map[string]interface{}
	if err := json.Unmarshal(configData, &config); err != nil {
		http.Error(w, "Invalid Jira config", http.StatusInternalServerError)
		return
	}

	// Check if API token and username are configured
	apiToken, hasToken := config["apiToken"].(string)
	username, hasUsername := config["username"].(string)

	if !hasToken || !hasUsername || apiToken == "" || username == "" {
		// Return empty array if not configured
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}

	// Create Jira client using the library
	baseUrl := config["baseUrl"].(string)
	jql := config["jql"].(string)
	maxResults := int(config["maxResults"].(float64))

	log.Printf("Connecting to Jira at: %s with user: %s", baseUrl, username)

	// Create Jira client (same method as your working code)
	client, err := jira.NewClient(nil, baseUrl)
	if err != nil {
		log.Printf("Failed to create Jira client: %v", err)
		http.Error(w, "Failed to connect to Jira", http.StatusInternalServerError)
		return
	}

	// Authenticate using session cookie (username + password)
	_, err = client.Authentication.AcquireSessionCookie(username, apiToken)
	if err != nil {
		log.Printf("Jira authentication failed: %v", err)
		http.Error(w, "Jira authentication failed - check username and password", http.StatusUnauthorized)
		return
	}
	log.Printf("Jira authentication successful with username: %s", username)

	// Search for issues using the library (exact same pattern as your working code)
	searchOptions := jira.SearchOptions{MaxResults: maxResults}
	issues, response, err := client.Issue.Search(jql, &searchOptions)
	if err != nil {
		log.Printf("Jira search failed: %v", err)
		if response != nil {
			log.Printf("Response status: %d", response.StatusCode)
			log.Printf("Response body: %s", response.Body)
		}
		log.Printf("JQL query: %s", jql)
		log.Printf("Base URL: %s", baseUrl)
		log.Printf("Username: %s", username)

		var errorMsg string
		if response != nil {
			switch response.StatusCode {
			case 401:
				errorMsg = "Jira authentication failed - check username and password/token"
			case 403:
				errorMsg = "Jira access forbidden - check user permissions"
			case 404:
				errorMsg = "Jira project not found - check project key"
			default:
				errorMsg = fmt.Sprintf("Jira API error: %d", response.StatusCode)
			}
		} else {
			errorMsg = "Failed to connect to Jira server"
		}
		http.Error(w, errorMsg, http.StatusInternalServerError)
		return
	}

	// Transform tickets to our format
	tickets := make([]map[string]interface{}, 0)
	for _, issue := range issues {
		ticket := map[string]interface{}{
			"key":     issue.Key,
			"summary": issue.Fields.Summary,
			"status":  issue.Fields.Status.Name,
		}

		// Add optional fields if they exist
		if issue.Fields.Assignee != nil {
			ticket["assignee"] = issue.Fields.Assignee.DisplayName
		}
		if issue.Fields.Priority != nil {
			ticket["priority"] = issue.Fields.Priority.Name
		}

		tickets = append(tickets, ticket)
	}

	log.Printf("Successfully fetched %d tickets from Jira", len(tickets))

	// Return tickets as JSON
	w.Header().Set("Content-Type", "application/json")

	// Force tickets to be an empty slice if it's nil
	if tickets == nil {
		tickets = []map[string]interface{}{}
	}

	jsonData, err := json.Marshal(tickets)
	if err != nil {
		log.Printf("JSON marshal error: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
	w.Write(jsonData)
}

// Handle holidays.json
func handleHolidays(w http.ResponseWriter, r *http.Request) {
	filePath := filepath.Join(dataDir, "holidays.json")

	switch r.Method {
	case http.MethodGet:
		serveJSONFile(w, filePath)
	case http.MethodPost:
		// Parse max backups from the request header
		maxBackupsStr := r.Header.Get("X-Max-Backups")
		maxBackups := defaultMaxBackups
		if maxBackupsStr != "" {
			if val, err := strconv.Atoi(maxBackupsStr); err == nil && val > 0 {
				maxBackups = val
			}
		}
		updateJSONFileWithBackup(w, r, filePath, maxBackups)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Handle backups API
func handleBackups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Return content + checksum when filename provided
		if filename := r.URL.Query().Get("filename"); filename != "" {
			fname := filepath.Base(filename)
			path := filepath.Join(backupDir, fname)
			data, err := os.ReadFile(path)
			if err != nil {
				http.Error(w, fmt.Sprintf("Error reading backup: %v", err), http.StatusInternalServerError)
				return
			}
			resp := map[string]any{
				"filename": fname,
				"checksum": computeETag(data),
				"content":  string(data),
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}

		// List backups for a file prefix
		filePrefix := r.URL.Query().Get("prefix")
		if filePrefix == "" {
			http.Error(w, "Missing 'prefix' parameter", http.StatusBadRequest)
			return
		}

		backups, err := listBackups(filePrefix)
		if err != nil {
			http.Error(w, fmt.Sprintf("Error listing backups: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(backups)

	case http.MethodDelete:
		// Delete a specific backup
		var requestData struct {
			Filename string `json:"filename"`
		}

		err := json.NewDecoder(r.Body).Decode(&requestData)
		if err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if requestData.Filename == "" {
			http.Error(w, "Missing filename", http.StatusBadRequest)
			return
		}

		// Sanitize filename to prevent directory traversal
		filename := filepath.Base(requestData.Filename)
		filePath := filepath.Join(backupDir, filename)

		if err := os.Remove(filePath); err != nil {
			http.Error(w, fmt.Sprintf("Error deleting backup: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success": true, "message": "Backup deleted successfully"}`))

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Handle backup settings
func handleBackupSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Return current backup settings
		settings := map[string]interface{}{
			"maxBackups": defaultMaxBackups,
			"backupDir":  backupDir,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Serve a JSON file
func serveJSONFile(w http.ResponseWriter, filePath string) {
	// If file doesn't exist, return an empty JSON object
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
		return
	}

	// Read and serve the file
	data, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// Update a JSON file with data from POST request
func updateJSONFile(w http.ResponseWriter, r *http.Request, filePath string) {
	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Validate that it's valid JSON
	var jsonData interface{}
	if err := json.Unmarshal(body, &jsonData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Basic schema validation depending on file
	if err := validateByPath(filePath, jsonData); err != nil {
		http.Error(w, fmt.Sprintf("Schema validation failed: %v", err), http.StatusBadRequest)
		return
	}

	// Pretty print the JSON
	prettyJSON, err := json.MarshalIndent(jsonData, "", "  ")
	if err != nil {
		http.Error(w, "Error formatting JSON", http.StatusInternalServerError)
		return
	}

	// Concurrency: If-Match check when file exists
	if _, err := os.Stat(filePath); err == nil {
		ifMatch := r.Header.Get("If-Match")
		if ifMatch != "" {
			current, _ := os.ReadFile(filePath)
			if computeETag(current) != ifMatch {
				w.Header().Set("ETag", computeETag(current))
				http.Error(w, "Precondition Failed", http.StatusPreconditionFailed)
				return
			}
		}

		// Create a backup of the existing file if it exists
		backupPath := filePath + ".bak." + time.Now().Format("20060102-150405")
		if err := os.Rename(filePath, backupPath); err != nil {
			log.Printf("Warning: could not create backup of %s: %v", filePath, err)
		}
		writeChecksum(backupPath)
	}

	// Write the new JSON to file
	if err := os.WriteFile(filePath, prettyJSON, 0644); err != nil {
		http.Error(w, "Error writing file", http.StatusInternalServerError)
		return
	}

	// Respond with success and new ETag
	w.Header().Set("ETag", computeETag(prettyJSON))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true, "message": "File updated successfully"}`))
}

// Update a JSON file with data from POST request and manage backups
func updateJSONFileWithBackup(w http.ResponseWriter, r *http.Request, filePath string, maxBackups int) {
	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Validate that it's valid JSON
	var jsonData interface{}
	if err := json.Unmarshal(body, &jsonData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Basic schema validation depending on file
	if err := validateByPath(filePath, jsonData); err != nil {
		http.Error(w, fmt.Sprintf("Schema validation failed: %v", err), http.StatusBadRequest)
		return
	}

	// Pretty print the JSON
	prettyJSON, err := json.MarshalIndent(jsonData, "", "  ")
	if err != nil {
		http.Error(w, "Error formatting JSON", http.StatusInternalServerError)
		return
	}

	// Get the base filename without path
	baseFilename := filepath.Base(filePath)

	// Concurrency: If-Match when file exists
	if _, err := os.Stat(filePath); err == nil {
		ifMatch := r.Header.Get("If-Match")
		if ifMatch != "" {
			current, _ := os.ReadFile(filePath)
			if computeETag(current) != ifMatch {
				w.Header().Set("ETag", computeETag(current))
				http.Error(w, "Precondition Failed", http.StatusPreconditionFailed)
				return
			}
		}

		// Create a backup in the backups directory
		timestamp := time.Now().Format("20060102-150405")
		backupFilename := fmt.Sprintf("%s.%s.json", strings.TrimSuffix(baseFilename, ".json"), timestamp)
		backupPath := filepath.Join(backupDir, backupFilename)

		// Copy the original file to the backup (don't move it)
		origData, err := os.ReadFile(filePath)
		if err != nil {
			log.Printf("Warning: could not read original file for backup %s: %v", filePath, err)
		} else {
			if err := os.WriteFile(backupPath, origData, 0644); err != nil {
				log.Printf("Warning: could not create backup of %s: %v", filePath, err)
			} else {
				log.Printf("Created backup: %s", backupPath)
				writeChecksum(backupPath)

				// Clean up old backups
				if err := cleanupOldBackups(baseFilename, maxBackups); err != nil {
					log.Printf("Warning: error cleaning up old backups: %v", err)
				}
			}
		}
	}

	// Write the new JSON to file
	if err := os.WriteFile(filePath, prettyJSON, 0644); err != nil {
		http.Error(w, "Error writing file", http.StatusInternalServerError)
		return
	}

	// Respond with success and new ETag
	w.Header().Set("ETag", computeETag(prettyJSON))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success": true, "message": "File updated successfully with backup"}`))
}

// computeETag returns a weak ETag of the content
func computeETag(b []byte) string {
	if b == nil {
		return "\"0\""
	}
	sum := sha256.Sum256(b)
	return fmt.Sprintf("\"%x\"", sum[:8])
}

// writeChecksum writes a .sha256 file alongside the backup for integrity
func writeChecksum(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	sum := sha256.Sum256(b)
	_ = os.WriteFile(path+".sha256", []byte(fmt.Sprintf("%x\n", sum)), 0644)
}

// validateByPath performs minimal schema checks per JSON file type
func validateByPath(path string, data interface{}) error {
	base := filepath.Base(path)
	switch base {
	case "environments.json":
		m, ok := data.(map[string]interface{})
		if !ok {
			return fmt.Errorf("environments.json must be an object")
		}
		if _, ok := m["environments"]; !ok {
			return fmt.Errorf("missing environments array")
		}
	case "releases.json":
		if _, ok := data.(map[string]interface{}); !ok {
			return fmt.Errorf("releases.json must be an object keyed by environment")
		}
	case "holidays.json":
		m, ok := data.(map[string]interface{})
		if !ok {
			return fmt.Errorf("holidays.json must be an object")
		}
		if _, ok := m["holidays"]; !ok {
			return fmt.Errorf("missing holidays array")
		}
	}
	return nil
}

// List backups for a specific file prefix
func listBackups(filePrefix string) ([]string, error) {
	files, err := os.ReadDir(backupDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read backup directory: %w", err)
	}

	var backups []string
	for _, file := range files {
		if !file.IsDir() && strings.HasPrefix(file.Name(), filePrefix) {
			backups = append(backups, file.Name())
		}
	}

	// Ensure we return an empty slice instead of nil so JSON encodes to [] not null
	if backups == nil {
		backups = []string{}
	}
	return backups, nil
}

// Clean up old backups, keeping only the newest maxBackups
func cleanupOldBackups(baseFilename string, maxBackups int) error {
	// Strip .json extension if present
	baseFilename = strings.TrimSuffix(baseFilename, ".json")

	// List all backups for this file
	backups, err := listBackups(baseFilename)
	if err != nil {
		return err
	}

	// If we don't have more than maxBackups, no need to delete any
	if len(backups) <= maxBackups {
		return nil
	}

	// Sort backups by timestamp (newest first)
	sort.Slice(backups, func(i, j int) bool {
		// Extract timestamps from filenames (format: filename.YYYYMMDD-HHMMSS.json)
		partsI := strings.Split(backups[i], ".")
		partsJ := strings.Split(backups[j], ".")

		// Ensure we have enough parts
		if len(partsI) < 3 || len(partsJ) < 3 {
			return backups[i] > backups[j] // fallback to string comparison
		}

		// Compare the timestamp parts
		return partsI[1] > partsJ[1]
	})

	// Delete all backups beyond maxBackups (keep newest ones)
	for i := maxBackups; i < len(backups); i++ {
		backupPath := filepath.Join(backupDir, backups[i])
		log.Printf("Deleting old backup: %s", backupPath)

		if err := os.Remove(backupPath); err != nil {
			return fmt.Errorf("failed to delete backup %s: %w", backupPath, err)
		}
	}

	return nil
}
