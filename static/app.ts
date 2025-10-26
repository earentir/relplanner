// Interfaces

// Declare external libraries for TypeScript
declare const flatpickr: any;
declare const tippy: any;

interface Environment {
  name: string;
  displayName: string;
  visible: boolean;
}

interface ReleaseEnvironmentConfig {
  background: string;
  foreground: string;
}

interface ReleaseStatusConfig {
  background: string;
  foreground: string;
}

// Release entries.
interface ReleaseEntry {
  date: string; // ISO date e.g. "2025-04-15"
  status: string; // Planned, Done, Hotfix Planned, Hotfix Done, None
  feTag?: string; // Frontend tag e.g. "3.44.0"
  beTag?: string; // Backend tag e.g. "1.15.0"
  releaseName?: string; // Auto-generated: FE.BE e.g. "3.44.0.1.15.0"
  jiraTicket?: string; // Jira ticket number
  startTime?: string; // Start time e.g. "20:00"
  endDateTime?: string; // End date & time e.g. "2025-04-16T03:00"
  note?: string;
  dependsOn?: string; // Dependency reference: "environment:date" e.g. "staging:2025-04-15"
}

interface ReleasesData {
  [environment: string]: ReleaseEntry[];
}

interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  priority?: string;
}


// Holiday entries (predefined or user-added).
interface Holiday {
  date: string;
  name: string;
}

interface HolidaysData {
  holidays: Holiday[];
}

interface EnvironmentsData {
  config: {
    displayType: "fullname" | "surname" | "username";
  };
  releaseEnvironments: { [env: string]: ReleaseEnvironmentConfig };
  releaseStatuses: { [status: string]: ReleaseStatusConfig };
  environments: Environment[];
}

interface ModalContext {
  environment: string;
  isoDate: string;
  cell: HTMLDivElement;
}

interface BackupConfig {
  maxBackups: number;
  enabled: boolean;
  backupFolder?: string;
}

// When the DOM content is loaded, initialize the app
document.addEventListener("DOMContentLoaded", initApp);
// Global state variables.
let environmentsData: EnvironmentsData;
let releasesData: ReleasesData;
let holidaysData: HolidaysData;
let currentYear: number;
let currentMonth: number; // 0-indexed

// Filter state
let currentNameFilter: string = '';
let currentTeamFilter: string = '';

// Continuous view variables
let continuousViewMode: boolean = false;
let continuousViewStartDate: Date;
let visibleDays: number = 31; // Will be adjusted based on actual month days
let loadedDateRanges: Set<string> = new Set();

// Get DOM elements once data has loaded
let monthSelect: HTMLSelectElement;
let yearSelect: HTMLSelectElement;
let environmentListDiv: HTMLDivElement;
let modal: HTMLDivElement;
let releaseStatusSelect: HTMLSelectElement;
let feTagInput: HTMLInputElement;
let beTagInput: HTMLInputElement;
let releaseNameInput: HTMLInputElement;
let jiraTicketInput: HTMLInputElement;
let jiraLink: HTMLAnchorElement;
let loadJiraTicketsButton: HTMLButtonElement;
let jiraTicketsList: HTMLDivElement;
let ticketsContainer: HTMLDivElement;
let startTimeInput: HTMLInputElement;
let endDateTimeInput: HTMLInputElement;
let dependsOnSelect: HTMLSelectElement;
let cancelButton: HTMLButtonElement;
let saveButton: HTMLButtonElement;
let removeButton: HTMLButtonElement;
let holidayInfo: HTMLDivElement;
let editableArea: HTMLDivElement;
let themeToggle: HTMLDivElement;

// New filter controls
// Filter elements removed - not used

// Quick actions elements
let quickActions: HTMLDivElement;
let actionShowToday: HTMLDivElement;
let actionToggleTheme: HTMLDivElement;
let actionExportData: HTMLDivElement;

// User statistics modal elements
let userStatsModal: HTMLDivElement;
let userStatsName: HTMLDivElement;
let userStatsContent: HTMLDivElement;
let userStatsCloseButton: HTMLButtonElement;

// Modal context.
let modalContext: { environment: string; isoDate: string; cell: HTMLDivElement } | null = null;

// Drag and drop variables
let draggedCell: HTMLDivElement | null = null;
let draggedEnvironment: string | null = null;
let draggedReleaseEntry: ReleaseEntry | null = null;
let draggedIndex: number = -1;

const backupConfig = {
  maxBackups: 3,  // Maximum number of backups to keep for each file type
  enabled: true  // Whether backups are enabled
};

/**
 * Close the modal.
 */
function closeModal() {
  modal.style.display = "none";
  modalContext = null;
  console.log("Modal closed");
}

/**
 * Auto-generate release name from FE and BE tags
 */
function generateReleaseName(feTag: string, beTag: string): string {
  if (!feTag || !beTag) return "";
  return `${feTag}.${beTag}`;
}

/**
 * Update release name field when FE or BE tags change
 */
function updateReleaseName() {
  const feTag = feTagInput.value.trim();
  const beTag = beTagInput.value.trim();
  releaseNameInput.value = generateReleaseName(feTag, beTag);
}

/**
 * Validate Jira ticket format (letters-dash-numbers)
 */
function isValidJiraTicket(ticket: string): boolean {
  const jiraPattern = /^[A-Z]+-\d+$/;
  return jiraPattern.test(ticket);
}

/**
 * Generate Jira URL for a ticket
 */
function generateJiraUrl(ticket: string): string {
  return `https://servicedesk.vodafoneinnovus.com/browse/${ticket}`;
}


/**
 * Update end date when end time is earlier than start time
 */
function updateEndDateTime() {
  const startTime = startTimeInput.value;
  const endDateTime = endDateTimeInput.value;
  
  if (startTime && endDateTime && modalContext) {
    const endTime = endDateTime.split('T')[1];
    // If end time is earlier than start time, set end date to next day
    if (endTime < startTime) {
      const currentDate = new Date(modalContext.isoDate);
      const nextDay = new Date(currentDate);
      nextDay.setDate(currentDate.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];
      endDateTimeInput.value = `${nextDayStr}T${endTime}`;
    } else {
      // If end time is later than start time, set to same day
      const currentDate = modalContext.isoDate;
      endDateTimeInput.value = `${currentDate}T${endTime}`;
    }
  }
}

/**
 * Parse FE and BE tags from Jira ticket summary
 * Expected format: "Release 3.44.0.1.125.0" -> FE: "3.44.0", BE: "1.125.0"
 */
function parseReleaseFromSummary(summary: string): { feTag: string; beTag: string } | null {
  // Look for pattern like "Release 3.44.0.1.125.0" or "3.44.0.1.125.0"
  const releaseMatch = summary.match(/(?:Release\s+)?(\d+\.\d+\.\d+)\.(\d+\.\d+\.\d+)/);
  if (releaseMatch) {
    return {
      feTag: releaseMatch[1], // e.g., "3.44.0"
      beTag: releaseMatch[2]  // e.g., "1.125.0"
    };
  }
  return null;
}

/**
 * Update Jira link based on ticket input
 */
function updateJiraLink() {
  const ticket = jiraTicketInput.value.trim().toUpperCase();
  if (ticket && isValidJiraTicket(ticket)) {
    jiraLink.href = generateJiraUrl(ticket);
    jiraLink.textContent = `🔗 Open ${ticket}`;
    jiraLink.style.display = "inline";
  } else {
    jiraLink.style.display = "none";
  }
}

/**
 * Load Jira tickets from the API
 */
async function loadJiraTickets() {
  try {
    loadJiraTicketsButton.textContent = "⏳ Loading...";
    loadJiraTicketsButton.disabled = true;
    
    const response = await fetch('/api/jira-tickets');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const tickets: JiraTicket[] = await response.json();
    console.log('loadJiraTickets - response.json() returned:', tickets);
    console.log('loadJiraTickets - tickets type:', typeof tickets);
    console.log('loadJiraTickets - tickets is null?', tickets === null);
    console.log('loadJiraTickets - tickets is undefined?', tickets === undefined);
    displayJiraTickets(tickets);
    
  } catch (error) {
    console.error('Failed to load Jira tickets:', error);
    let errorMessage = 'Failed to load tickets. Check Jira configuration.';
    
    if (error instanceof Error && error.message.includes('HTTP error!')) {
      // Try to extract more specific error from the response
      errorMessage = 'Failed to load tickets. Please check your Jira credentials and permissions.';
    }
    
    ticketsContainer.innerHTML = `<div style="color: red;">${errorMessage}</div>`;
  } finally {
    loadJiraTicketsButton.textContent = "📋 Load Tickets";
    loadJiraTicketsButton.disabled = false;
  }
}

/**
 * Display Jira tickets in the modal
 */
function displayJiraTickets(tickets: JiraTicket[]) {
  console.log('displayJiraTickets called with:', tickets);
  console.log('tickets type:', typeof tickets);
  console.log('tickets is null?', tickets === null);
  console.log('tickets is undefined?', tickets === undefined);
  
  if (!tickets || tickets.length === 0) {
    ticketsContainer.innerHTML = `
      <div style="color: #666; padding: 10px; text-align: center;">
        <div>No tickets found.</div>
        <div style="font-size: 12px; margin-top: 5px;">
          This could mean:<br>
          • No Jira credentials configured<br>
          • No tickets match the current filter<br>
          • Jira API access issues
        </div>
      </div>
    `;
    jiraTicketsList.style.display = "block";
    return;
  }
  
  ticketsContainer.innerHTML = '';
  
  tickets.forEach(ticket => {
    const ticketDiv = document.createElement('div');
    ticketDiv.style.cssText = `
      padding: 8px;
      margin: 4px 0;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      background: white;
      transition: background-color 0.2s;
    `;
    
    ticketDiv.innerHTML = `
      <div style="font-weight: bold; color: #007bff;">${ticket.key}</div>
      <div style="font-size: 12px; color: #666; margin-top: 2px;">${ticket.summary}</div>
      <div style="font-size: 11px; color: #888; margin-top: 2px;">
        Status: ${ticket.status}${ticket.assignee ? ` | Assignee: ${ticket.assignee}` : ''}${ticket.priority ? ` | Priority: ${ticket.priority}` : ''}
      </div>
    `;
    
    ticketDiv.addEventListener('mouseenter', () => {
      ticketDiv.style.backgroundColor = '#f0f8ff';
    });
    
    ticketDiv.addEventListener('mouseleave', () => {
      ticketDiv.style.backgroundColor = 'white';
    });
    
    ticketDiv.addEventListener('click', () => {
      jiraTicketInput.value = ticket.key;
      updateJiraLink();
      
      // Parse release info from ticket summary
      const releaseInfo = parseReleaseFromSummary(ticket.summary);
      if (releaseInfo) {
        feTagInput.value = releaseInfo.feTag;
        beTagInput.value = releaseInfo.beTag;
        updateReleaseName(); // Auto-generate release name
      }
      
      jiraTicketsList.style.display = "none";
    });
    
    ticketsContainer.appendChild(ticketDiv);
  });
  
  jiraTicketsList.style.display = "block";
}

/**
 * Save modal changes.
 */
function saveModal() {
  if (!modalContext) return;
  const { environment, isoDate, cell } = modalContext;

  if (getHoliday(isoDate)) {
    closeModal();
    return;
  }

  // Check if it's a weekend
  if (isWeekend(isoDate)) {
    closeModal();
    return;
  }

  const selectedStatus = releaseStatusSelect.value;
  const feTag = feTagInput.value.trim();
  const beTag = beTagInput.value.trim();
  const jiraTicket = jiraTicketInput.value.trim();
    const startTime = startTimeInput.value;
    const endDateTime = endDateTimeInput.value;
  const dependsOn = dependsOnSelect.value;
  const note = "";

  if (!releasesData[environment]) {
    releasesData[environment] = [];
  }
  const environmentReleases = releasesData[environment];
  const existingIndex = environmentReleases.findIndex((entry) => entry.date === isoDate);

  if (selectedStatus === "" || selectedStatus === "None") {
    if (existingIndex !== -1) {
      environmentReleases.splice(existingIndex, 1);
      cell.style.backgroundColor = "";
      cell.style.color = "";
      cell.classList.remove("release");
      cell.removeAttribute("draggable");
      delete cell.dataset.status;

      // Clear tooltip when removing release
      cell.title = "";
      cell.removeAttribute('data-tooltip');
    }
  } else {
    const releaseEntry: ReleaseEntry = { 
      date: isoDate, 
      status: selectedStatus
    };
    
    // Add optional fields if they have values
    if (feTag !== "") releaseEntry.feTag = feTag;
    if (beTag !== "") releaseEntry.beTag = beTag;
    if (jiraTicket !== "") releaseEntry.jiraTicket = jiraTicket;
    if (startTime !== "") releaseEntry.startTime = startTime;
    if (endDateTime !== "") releaseEntry.endDateTime = endDateTime;
    if (dependsOn !== "") releaseEntry.dependsOn = dependsOn;
    if (note !== "") releaseEntry.note = note;
    
    // Auto-generate release name if both FE and BE tags are provided
    if (feTag !== "" && beTag !== "") {
      releaseEntry.releaseName = generateReleaseName(feTag, beTag);
    }
    
    if (existingIndex === -1) {
      environmentReleases.push(releaseEntry);
    } else {
      environmentReleases[existingIndex] = releaseEntry;
    }
    
    // Use status color for background and text
    const statusConfig = environmentsData.releaseStatuses[selectedStatus];
    
    cell.style.backgroundColor = statusConfig.background;
    cell.style.color = statusConfig.foreground;
    cell.classList.add("release");
    cell.classList.remove("holiday");
    cell.dataset.status = selectedStatus;
    cell.setAttribute("draggable", "true");

    // Set tooltip for release with comprehensive information
    let tooltipParts = [`${environment} - ${selectedStatus}`];
    if (releaseEntry.releaseName) tooltipParts.push(`Release: ${releaseEntry.releaseName}`);
    if (jiraTicket) {
      if (isValidJiraTicket(jiraTicket)) {
        tooltipParts.push(`Jira: ${jiraTicket} (click to open)`);
      } else {
        tooltipParts.push(`Jira: ${jiraTicket}`);
      }
    }
    if (startTime && endDateTime) {
      const endDate = endDateTime.split('T')[0];
      const endTime = endDateTime.split('T')[1];
      if (endDate !== isoDate) {
        tooltipParts.push(`Time: ${startTime} (${isoDate}) - ${endTime} (${endDate})`);
      } else {
        tooltipParts.push(`Time: ${startTime}-${endTime}`);
      }
    }
    if (note) tooltipParts.push(`Note: ${note}`);
    
    cell.setAttribute('data-tooltip', tooltipParts.join('\n'));

    setupDragEvents(cell, environment, releaseEntry);
  }

  console.log("Saving modal data for environment:", environment, "for date:", isoDate);
  closeModal();
  saveData(environment);
}

/**
 * Remove a release entry.
 */
function removeRelease() {
  console.log("Remove button clicked!");
  if (!modalContext) {
    console.log("No modal context available");
    return;
  }
  const { environment, isoDate, cell } = modalContext;
  const environmentReleases = releasesData[environment] || [];
  const index = environmentReleases.findIndex((entry) => entry.date === isoDate);

  if (index !== -1) {
    environmentReleases.splice(index, 1);
    cell.style.backgroundColor = "";
    cell.style.color = "";
    cell.classList.remove("release");
    cell.removeAttribute("draggable");
    delete cell.dataset.status;

    // Clear tooltip when removing release
    cell.title = "";
    cell.removeAttribute('data-tooltip');
  }

  console.log("Removed release for", environment, "date:", isoDate);
  closeModal();
  saveData(environment, true); // Force save when removing
  
  // Rebuild calendar to ensure UI reflects the removal
  buildCalendar(currentYear, currentMonth);
}

function updatePairedEmployeeCalendar(username: string, isoDate: string) {
  // This function is no longer needed for release planning as we don't have paired employee conflicts
  // Keeping the function for compatibility but it does nothing
  return;
}

// Store last saved data hash to detect changes
let lastSavedReleasesHash: string | null = null;

/**
 * Generate a simple hash of the releases data to detect changes
 */
function generateReleasesHash(data: any): string {
  return btoa(JSON.stringify(data)).slice(0, 16); // Simple hash using base64
}

/**
 * Save data to the server - only saves what actually changed
 */
async function saveData(environment, forceSave = false) {
  try {
    // Check if releases data has actually changed (unless force save is requested)
    if (!forceSave) {
      const currentHash = generateReleasesHash(releasesData);
      if (lastSavedReleasesHash === currentHash) {
        console.log(`No changes detected for ${environment}, skipping save`);
        return;
      }
    }

    console.log(`Saving data for ${environment}...`);

    // Only send backup config if backups are enabled
    const maxBackupsHeader = backupConfig.enabled ? backupConfig.maxBackups.toString() : "0";

    // Get current ETags for optimistic concurrency
    const etagDaysRes = await fetch('/api/releases.json');
    const etagDays = etagDaysRes.headers.get('ETag') || '';

    // Only save releases - holidays are never modified in the app
    const daysOffResponse = await fetch("/api/releases.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Max-Backups": maxBackupsHeader,
        "If-Match": etagDays
      },
      body: JSON.stringify(releasesData)
    });

    if (!daysOffResponse.ok) {
      const txt = await daysOffResponse.text();
      throw new Error(`releases save failed (${daysOffResponse.status}): ${txt}`);
    }

    // Update the hash after successful save with current data
    lastSavedReleasesHash = generateReleasesHash(releasesData);

    console.log(`Data saved successfully for ${environment}`);
    showNotification("Changes saved successfully", "success");
  } catch (error) {
    console.error("Error saving data:", error);
    showNotification(`Failed to save changes: ${error instanceof Error ? error.message : error}` as any, "error");
  }
}

/**
 * Save employees data (used when updating per-year allowances)
 */
async function saveEmployeesData() {
  try {
    console.log("Saving employees data (allowances)...");
    const response = await fetch("/api/environments.json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(environmentsData)
    });
    if (!response.ok) {
      throw new Error("Failed to save employees.json");
    }
    showNotification("Allowances saved", "success");
  } catch (error) {
    console.error("Error saving employees.json", error);
    showNotification("Failed to save allowances", "error");
  }
}

async function loadBackupSettings() {
  try {
    const response = await fetch("/api/backup-settings");
    if (!response.ok) {
      throw new Error("Failed to load backup settings");
    }

    const settings = await response.json();
    if (settings.maxBackups) {
      backupConfig.maxBackups = settings.maxBackups;
    }

    // Also check local storage for user preferences
    const savedConfig = localStorage.getItem("backupConfig");
    if (savedConfig) {
      try {
        const parsedConfig = JSON.parse(savedConfig);
        backupConfig.enabled = parsedConfig.enabled !== undefined ? parsedConfig.enabled : true;
        backupConfig.maxBackups = parsedConfig.maxBackups || backupConfig.maxBackups;
      } catch (error) {
        console.error("Error parsing backup config from localStorage:", error);
      }
    }

    console.log("Loaded backup configuration:", backupConfig);
  } catch (error) {
    console.error("Error loading backup settings:", error);
  }
}

// Function to list available backups for a file
async function listBackups(filePrefix) {
  try {
    const response = await fetch(`/api/backups?prefix=${filePrefix}`);
    if (!response.ok) {
      throw new Error("Failed to list backups");
    }

    return await response.json();
  } catch (error) {
    console.error("Error listing backups:", error);
    return [];
  }
}

function saveBackupConfig() {
  localStorage.setItem("backupConfig", JSON.stringify(backupConfig));
  showNotification("Backup settings saved", "success");
}

function createSettingsModal() {
  // Check if the modal already exists
  if (document.getElementById("settingsModal")) {
    const existing = document.getElementById("settingsModal") as HTMLDivElement;
    if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
    return;
  }

  const modal = document.createElement("div");
  modal.id = "settingsModal";
  modal.className = "modal";

  modal.innerHTML = `
    <div class="modal-content">
      <h3>App Settings</h3>
      <div class="settings-section">
        <h4>Backup Settings</h4>
        <div class="form-group">
          <label for="backupEnabled">Enable Backups:</label>
          <input type="checkbox" id="backupEnabled" ${backupConfig.enabled ? 'checked' : ''}>
        </div>
        <div class="form-group">
          <label for="maxBackups">Max Backups to Keep:</label>
          <input type="number" id="maxBackups" min="1" max="100" value="${backupConfig.maxBackups}">
        </div>
      </div>
      <div class="modal-buttons">
        <button id="settingsCancelButton">Cancel</button>
        <button id="settingsSaveButton">Save</button>
      </div>
    </div>
  `;

  // We no longer use this legacy settings modal; keep function for compatibility
  // but do not append to DOM.
  // document.body.appendChild(modal);

  // Add event listeners
  const cancelButton = document.getElementById("settingsCancelButton");
  const saveButton = document.getElementById("settingsSaveButton");
  const backupEnabledInput = document.getElementById("backupEnabled");
  const maxBackupsInput = document.getElementById("maxBackups");

  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      if (modal) {
        modal.style.display = "none";
      }
    });
  }

  if (saveButton && backupEnabledInput && maxBackupsInput && modal) {
    saveButton.addEventListener("click", () => {
      // Cast to appropriate HTML input element types
      const enabledInput = backupEnabledInput as HTMLInputElement;
      const maxInput = maxBackupsInput as HTMLInputElement;

      // Update the backup config
      backupConfig.enabled = enabledInput.checked;
      backupConfig.maxBackups = parseInt(maxInput.value, 10) || 10;

      saveBackupConfig();
      modal.style.display = "none";
      showNotification("Settings saved successfully", "success");
    });
  }

  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // Close with ESC key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") {
      modal.style.display = "none";
    }
  });

  return modal;
}

// Function to show the settings modal
function showSettingsModal() {
  // Redirect to unified Operations dialog Backups tab
  showOperationsDialog("backups");
  return;

  // Type assertions to tell TypeScript these are input elements
  const backupEnabledElement = document.getElementById("backupEnabled") as HTMLInputElement;
  const maxBackupsElement = document.getElementById("maxBackups") as HTMLInputElement;

  // Check if elements exist before accessing properties
  if (backupEnabledElement) {
    backupEnabledElement.checked = backupConfig.enabled;
  }

  if (maxBackupsElement) {
    maxBackupsElement.value = backupConfig.maxBackups.toString();
  }

  // Make sure modal is defined before using it
  if (modal) {
    modal.style.display = "flex";
  }
}

// Add settings button to the actions menu
function addSettingsMenuItem() {
  const actionsMenu = document.getElementById("actionsMenu");
  if (!actionsMenu) return;

  const settingsButton = document.createElement("div");
  settingsButton.id = "actionSettings";
  settingsButton.className = "action-button";
  settingsButton.textContent = "Settings";

  settingsButton.addEventListener("click", () => {
    actionsMenu.classList.remove("visible");
    const backdrop = document.querySelector(".menu-backdrop");
    if (backdrop) backdrop.classList.remove("visible");
    // Open unified dialog on Backups tab instead of legacy settings modal
    showOperationsDialog("backups");
  });

  // Add after export data button if it exists, otherwise at the end
  const exportButton = document.getElementById("actionExportData");
  if (exportButton) {
    actionsMenu.insertBefore(settingsButton, exportButton.nextSibling);
  } else {
    actionsMenu.appendChild(settingsButton);
  }
}


// Function to delete a specific backup
async function deleteBackup(filename) {
  try {
    const response = await fetch("/api/backups", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ filename })
    });

    if (!response.ok) {
      throw new Error("Failed to delete backup");
    }

    return true;
  } catch (error) {
    console.error("Error deleting backup:", error);
    return false;
  }
}

async function createBackup(filename, data) {
  try {
    // Create the new backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${filename.replace('.json', '')}-${timestamp}.json`;
    const backupPath = `${(backupConfig as BackupConfig).backupFolder ?? 'defaultFolder'}/${backupFilename}`;

    console.log(`Creating backup: ${backupPath}`);

    // Save the backup
    const backupResponse = await fetch(`/api/backup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Backup-Filename": backupPath
      },
      body: JSON.stringify(data)
    });

    if (!backupResponse.ok) {
      throw new Error(`Failed to create backup: ${backupPath}`);
    }

    // Get list of existing backups for this file type
    const backupListResponse = await fetch(`/api/list-backups?prefix=${filename.replace('.json', '')}`);
    if (!backupListResponse.ok) {
      throw new Error("Failed to list backups");
    }

    const backupList = await backupListResponse.json();
    console.log(`Found ${backupList.length} backups, limit is ${backupConfig.maxBackups}`);

    // If we have more backups than the configured maximum, delete the oldest ones
    if (backupList.length > backupConfig.maxBackups) {
      // Sort backups by creation date (newest first)
      backupList.sort((a, b) => {
        // Extract timestamps from filenames and compare them
        const timestampA = a.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)[0];
        const timestampB = b.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)[0];
        return timestampB.localeCompare(timestampA); // Newest first
      });

      // Keep only the most recent maxBackups, delete the rest
      const backupsToKeep = backupList.slice(0, backupConfig.maxBackups);
      const backupsToDelete = backupList.slice(backupConfig.maxBackups);

      console.log(`Keeping ${backupsToKeep.length} recent backups, deleting ${backupsToDelete.length} old backups`);

      // Delete old backups
      for (const fileToDelete of backupsToDelete) {
        console.log(`Deleting old backup: ${fileToDelete}`);

        const deleteResponse = await fetch(`/api/delete-backup`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ filename: fileToDelete })
        });

        if (!deleteResponse.ok) {
          console.warn(`Failed to delete backup: ${fileToDelete}`);
        }
      }
    }

    console.log(`Backup created successfully: ${backupPath}`);
    return true;
  } catch (error) {
    console.error("Error creating backup:", error);
    return false;
  }
}

/**
 * Load JSON data from the server.
 */
async function loadData() {
  try {
  const [employeesRes, daysOffRes, holidaysRes] = await Promise.all([
    fetch("/api/environments.json"),
    fetch("/api/releases.json"),
    fetch("/api/holidays.json")
  ]);

    // Check if responses are OK
    if (!employeesRes.ok || !daysOffRes.ok || !holidaysRes.ok) {
      throw new Error("Failed to load data from server");
    }

    environmentsData = await employeesRes.json();
    releasesData = await daysOffRes.json();
    holidaysData = await holidaysRes.json();

    // Validate data structure
    if (!environmentsData.environments || !Array.isArray(environmentsData.environments)) {
      throw new Error("Invalid environments data structure");
    }
    if (!environmentsData.releaseEnvironments || typeof environmentsData.releaseEnvironments !== 'object') {
      throw new Error("Invalid releaseEnvironments data structure");
    }
    if (!environmentsData.releaseStatuses || typeof environmentsData.releaseStatuses !== 'object') {
      throw new Error("Invalid releaseStatuses data structure");
    }
    if (!holidaysData.holidays || !Array.isArray(holidaysData.holidays)) {
      throw new Error("Invalid holidays data structure");
    }

    console.log("Data loaded successfully:", {
      environmentsCount: environmentsData.environments.length,
      releaseEnvironmentsCount: Object.keys(environmentsData.releaseEnvironments).length,
      releaseStatusesCount: Object.keys(environmentsData.releaseStatuses).length,
      holidaysCount: holidaysData.holidays.length
    });
    return true;
  } catch (error) {
    console.error("Error loading data", error);
    showNotification("Error loading data. Please refresh the page or contact support.", "error");
    return false;
  }
}

/**
 * Show notification to the user
 */
function showNotification(message: string, type: "success" | "error" | "info" = "info") {
  // Create notification element if it doesn't exist
  let notification = document.getElementById("notification");
  if (!notification) {
    notification = document.createElement("div");
    notification.id = "notification";
    document.body.appendChild(notification);
  }

  // Set notification content and style
  notification.textContent = message;
  notification.className = `notification ${type}`;

  // Show notification
  notification.style.display = "block";

  // Auto-hide after 3 seconds
  setTimeout(() => {
    notification.style.display = "none";
  }, 3000);
}

/**
 * Set up quick action handlers
 */
function setupQuickActions() {
  // Check if quick action elements exist
  if (!actionShowToday || !actionToggleTheme || !actionExportData) {
    console.error("Quick action elements not found");
    return;
  }

  // Show Today action
  actionShowToday.addEventListener("click", () => {
    const today = new Date();
    currentMonth = today.getMonth();
    currentYear = today.getFullYear();

    // Update the dropdowns
    monthSelect.value = currentMonth.toString();
    yearSelect.value = currentYear.toString();

    // Rebuild the calendar
    buildCalendar(currentYear, currentMonth);

    showNotification("Calendar set to current month", "info");
  });

  // Toggle Theme action
  actionToggleTheme.addEventListener("click", () => {
    if (document.body.classList.contains("dark")) {
      document.body.classList.remove("dark");
      document.body.classList.add("light");
    } else {
      document.body.classList.remove("light");
      document.body.classList.add("dark");
    }
    updateThemeToggleText();
  });

  // Export/Backup/Restore unified dialog
  actionExportData.addEventListener("click", () => {
    showOperationsDialog("export");
  });
}

/**
 * Export calendar data
 */
function exportCalendarData() {
  try {
    // Create export data object
    const exportData = {
      month: currentMonth,
      year: currentYear,
      environmentsData: environmentsData,
      releasesData: releasesData,
      holidaysData: holidaysData,
      exportDate: new Date().toISOString()
    };

    // Convert to JSON
    const dataStr = JSON.stringify(exportData, null, 2);

    // Create download link
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `calendar-export-${currentYear}-${currentMonth + 1}.json`;

    // Instead of exporting immediately, open the unified dialog
    showOperationsDialog("export");
  } catch (error) {
    console.error("Error opening export dialog:", error);
    showNotification("Failed to export data", "error");
  }
}

// Export in selected format: json | xml | csv
function exportCalendarDataAs(format: "json" | "xml" | "csv") {
  try {
    const exportObj = {
      month: currentMonth,
      year: currentYear,
      environmentsData,
      releasesData,
      holidaysData,
      exportDate: new Date().toISOString()
    };

    let dataStr = "";
    let mime = "application/octet-stream";
    let filename = `calendar-export-${currentYear}-${currentMonth + 1}.${format}`;

    if (format === "json") {
      dataStr = JSON.stringify(exportObj, null, 2);
      mime = "application/json";
    } else if (format === "xml") {
      dataStr = convertExportToXML(exportObj);
      mime = "application/xml";
    } else if (format === "csv") {
      dataStr = convertExportToCSV(exportObj);
      mime = "text/csv";
    }

    const dataUri = `data:${mime};charset=utf-8,` + encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', filename);
    linkElement.click();
    showNotification(`Exported ${format.toUpperCase()} successfully`, "success");
  } catch (error) {
    console.error("Error exporting data:", error);
    showNotification("Failed to export data", "error");
  }
}

// Generate a single ICS for the current month for all visible employees
function exportIcsForVisible() {
  try {
    const now = new Date();
    const dtstamp = toIcsDateTime(now);
    const monthStart = new Date(currentYear, currentMonth, 1);
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//timeoff//calendar//EN\nCALSCALE:GREGORIAN\n";

    const visibleEnvironments = environmentsData.environments.filter(e => e.visible);
    for (const env of visibleEnvironments) {
      const entries = (releasesData[env.name] || []);
      for (const entry of entries) {
        const d = parseLocalDate(entry.date);
        if (d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
        const dt = toIcsDate(entry.date); // all-day
        const uid = `${env.name}-${entry.date}@release`;
        const type = entry.status || "Release";
        const note = entry.note ? ` (${entry.note})` : "";
        const summary = `${env.name}: ${type}${note}`;
        const desc = summary;
        ics += `BEGIN:VEVENT\nUID:${uid}\nDTSTAMP:${dtstamp}\nDTSTART;VALUE=DATE:${dt}\nDTEND;VALUE=DATE:${nextIcsDate(entry.date)}\nSUMMARY:${escapeIcs(summary)}\nDESCRIPTION:${escapeIcs(desc)}\nEND:VEVENT\n`;
      }
    }
    ics += "END:VCALENDAR\n";

    const dataUri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    const fname = `calendar-${currentYear}-${currentMonth + 1}.ics`;
    const a = document.createElement('a');
    a.setAttribute('href', dataUri);
    a.setAttribute('download', fname);
    a.click();
    showNotification("Exported ICS successfully", "success");
  } catch (e) {
    console.error("ICS export error", e);
    showNotification("Failed to export ICS", "error");
  }
}

function toIcsDate(isoDate: string): string {
  // YYYY-MM-DD -> YYYYMMDD in local time context
  return isoDate.replaceAll('-', '');
}

function nextIcsDate(isoDate: string): string {
  const d = parseLocalDate(isoDate);
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
}

function toIcsDateTime(d: Date): string {
  // UTC timestamp YYYYMMDDTHHMMSSZ
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function convertExportToXML(obj: any): string {
  // Minimal XML conversion tailored to known structure
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const environmentXml = obj.environmentsData.environments.map((e: any) => {
    const attrs = ["name","displayName","visible"].map(k => e[k] !== undefined ? `<${k}>${esc(String(e[k]))}</${k}>` : "").join("");
    return `<environment>${attrs}</environment>`;
  }).join("");
  const releaseEnvironments = Object.keys(obj.releasesData || {});
  const releasesXml = releaseEnvironments.map(env => {
    const entries = (obj.releasesData[env] || []).map((d: any) => {
      const note = d.note ? `<note>${esc(String(d.note))}</note>` : "";
      return `<entry><date>${esc(d.date)}</date><status>${esc(d.status)}</status>${note}</entry>`;
    }).join("");
    return `<environment name="${esc(env)}">${entries}</environment>`;
  }).join("");
  const holidaysXml = (obj.holidaysData.holidays || []).map((h: any) => `<holiday><date>${esc(h.date)}</date><name>${esc(h.name)}</name></holiday>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<calendarExport>\n  <month>${obj.month}</month>\n  <year>${obj.year}</year>\n  <exportDate>${esc(obj.exportDate)}</exportDate>\n  <environments>${environmentXml}</environments>\n  <releases>${releasesXml}</releases>\n  <holidays>${holidaysXml}</holidays>\n</calendarExport>`;
}

function convertExportToCSV(obj: any): string {
  // Create three CSV sections separated by blank lines
  const csvEsc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  // Environments
  const envHeaders = ["name","displayName","visible"];
  const envRows = obj.environmentsData.environments.map((e: any) => envHeaders.map(h => csvEsc(e[h])).join(","));
  const environmentsCsv = [envHeaders.join(","), ...envRows].join("\n");
  // Releases
  const releaseHeaders = ["environment","date","status","note"];
  const releaseRows: string[] = [];
  Object.keys(obj.releasesData || {}).forEach(env => {
    (obj.releasesData[env] || []).forEach((d: any) => {
      releaseRows.push([csvEsc(env), csvEsc(d.date), csvEsc(d.status), csvEsc(d.note ?? "")].join(","));
    });
  });
  const releasesCsv = [releaseHeaders.join(","), ...releaseRows].join("\n");
  // Holidays
  const holHeaders = ["date","name"];
  const holRows = (obj.holidaysData.holidays || []).map((h: any) => [csvEsc(h.date), csvEsc(h.name)].join(","));
  const holidaysCsv = [holHeaders.join(","), ...holRows].join("\n");
  return `# Environments\n${environmentsCsv}\n\n# Releases\n${releasesCsv}\n\n# Holidays\n${holidaysCsv}\n`;
}

// Unified operations dialog (Export, Backups)
function showOperationsDialog(initialTab: "export" | "backups" = "export") {
  let dlg = document.getElementById("exportDialog") as HTMLDivElement | null;
  if (!dlg) {
    dlg = document.createElement("div");
    dlg.id = "exportDialog";
    dlg.className = "modal";
    dlg.innerHTML = `
      <div class="modal-content">
        <h3>Operations</h3>
        <div class="ops-tabs" style="display:flex; gap:8px; margin-bottom:10px;">
          <button id="tabExport" class="ops-tab active">Export</button>
          <button id="tabBackups" class="ops-tab">Backups</button>
          <button id="tabRestore" class="ops-tab">Restore</button>
        </div>
        <div id="opsExport" style="display:none;">
          <div class="form-group">
            <label>Select format:</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button id="btnExportJson">JSON</button>
              <button id="btnExportXml">XML</button>
              <button id="btnExportCsv">CSV</button>
              <button id="btnExportIcs">ICS</button>
            </div>
          </div>
        </div>
        <div id="opsBackups" style="display:none;">
          <div class="form-group">
            <label>File:</label>
            <select id="backupFileSelect">
              <option value="employees">employees.json</option>
              <option value="releases">releases.json</option>
              <option value="holidays">holidays.json</option>
            </select>
          </div>
          <div class="form-group">
            <label>Available backups:</label>
            <div id="backupList" style="max-height:200px; overflow:auto; border:1px solid #ccc; padding:6px;"></div>
          </div>
          <div class="form-group">
            <label>Preview:</label>
            <div id="backupMeta" class="form-help"></div>
            <textarea id="backupPreview" style="width:100%; height:180px;"></textarea>
            <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
              <button id="btnBackupNow">Backup now</button>
            </div>
          </div>
        </div>
        <div id="opsRestore" style="display:none;">
          <div class="form-group">
            <label>Target file:</label>
            <select id="restoreFileSelect">
              <option value="employees">employees.json</option>
              <option value="releases">releases.json</option>
              <option value="holidays">holidays.json</option>
            </select>
          </div>
          <div class="form-group">
            <label>Upload file:</label>
            <input type="file" id="restoreFileInput" accept=".json,application/json" />
          </div>
          <div class="form-group">
            <label>Or paste JSON content:</label>
            <textarea id="restorePaste" style="width:100%; height:180px;"></textarea>
          </div>
          <div class="form-group" style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="btnDoRestore">Restore</button>
          </div>
        </div>
        <div class="modal-buttons">
          <button id="exportCancel">Close</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg!.style.display = "none";
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dlg && dlg.style.display === "flex") dlg.style.display = "none";
    });
  }
  const tabExport = document.getElementById("tabExport") as HTMLButtonElement;
  const tabBackups = document.getElementById("tabBackups") as HTMLButtonElement;
  const tabRestore = document.getElementById("tabRestore") as HTMLButtonElement;
  const panelExport = document.getElementById("opsExport") as HTMLDivElement;
  const panelBackups = document.getElementById("opsBackups") as HTMLDivElement;
  const panelRestore = document.getElementById("opsRestore") as HTMLDivElement;
  const showTab = (tab: "export" | "backups") => {
    const setActive = (btn?: HTMLButtonElement) => {
      document.querySelectorAll('.ops-tab').forEach(el => el.classList.remove('active'));
      if (btn) btn.classList.add('active');
    };
    panelExport.style.display = "none";
    panelBackups.style.display = "none";
    panelRestore.style.display = "none";
    if (tab === "export") { panelExport.style.display = "block"; setActive(tabExport); }
    else if (tab === "backups") { panelBackups.style.display = "block"; setActive(tabBackups); refreshBackupsList(); }
    else { panelRestore.style.display = "block"; setActive(tabRestore); }
  };
  if (tabExport) tabExport.onclick = () => showTab("export");
  if (tabBackups) tabBackups.onclick = () => showTab("backups");
  if (tabRestore) tabRestore.onclick = () => showTab("restore" as any);

  const btnJson = document.getElementById("btnExportJson");
  const btnXml = document.getElementById("btnExportXml");
  const btnCsv = document.getElementById("btnExportCsv");
  const btnIcs = document.getElementById("btnExportIcs");
  const btnCancel = document.getElementById("exportCancel");
  if (btnJson) btnJson.onclick = () => { exportCalendarDataAs("json"); };
  if (btnXml) btnXml.onclick = () => { exportCalendarDataAs("xml"); };
  if (btnCsv) btnCsv.onclick = () => { exportCalendarDataAs("csv"); };
  if (btnIcs) btnIcs.onclick = () => { exportIcsForVisible(); };
  if (btnCancel) btnCancel.onclick = () => { (document.getElementById("exportDialog") as HTMLDivElement).style.display = "none"; };

  // Backups wiring
  const sel = document.getElementById("backupFileSelect") as HTMLSelectElement;
  if (sel) sel.onchange = () => refreshBackupsList();
  async function refreshBackupsList() {
    const list = document.getElementById("backupList") as HTMLDivElement;
    const meta = document.getElementById("backupMeta") as HTMLDivElement;
    const preview = document.getElementById("backupPreview") as HTMLTextAreaElement;
    const btnBackupNow = document.getElementById("btnBackupNow") as HTMLButtonElement;
    if (!list || !sel) return;
    list.innerHTML = "Loading...";
    const prefix = (sel.value || "");
    try {
      // Always load current file content into preview first
      const currentPath = prefix === 'employees' ? '/api/employees.json' : (prefix === 'daysOff' ? '/api/daysOff.json' : '/api/holidays.json');
      const curRes = await fetch(currentPath);
      if (curRes.ok) {
        const curText = await curRes.text();
        preview.value = curText;
        meta.textContent = 'current';
      }

      const res = await fetch(`/api/backups?prefix=${prefix}`);
      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`Failed to list backups (${res.status}): ${rawText}`);
      }
      let files: any;
      try { files = JSON.parse(rawText); } catch (e) {
        throw new Error(`Server returned non-JSON: ${rawText}`);
      }
      if (!Array.isArray(files)) {
        throw new Error(`Unexpected response (not array): ${rawText}`);
      }
      if (files.length === 0) { list.innerHTML = "No backups."; return; }
      list.innerHTML = "";
      files.forEach(fn => {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = fn;
        a.style.display = 'block';
        a.onclick = async (e) => {
          e.preventDefault();
          const r = await fetch(`/api/backups?filename=${encodeURIComponent(fn)}`);
          if (!r.ok) { meta.textContent = "Failed to load"; return; }
          const j = await r.json();
          meta.textContent = `checksum: ${j.checksum}`;
          preview.value = j.content || '';
        };
        list.appendChild(a);
      });

      if (btnBackupNow) {
        btnBackupNow.onclick = () => handleBackupNow(prefix);
      }
    } catch (err: any) {
      list.innerHTML = `Error loading backups: ${err?.message ?? err}`;
    }
  }

  async function handleRestore(which: string, content: string) {
    if (!confirm(`Restore ${which}.json from selected backup? This will overwrite current data.`)) return;
    const path = which === 'employees' ? '/api/employees.json' : (which === 'releases' ? '/api/releases.json' : '/api/holidays.json');
    try {
      // fetch current ETag
      const head = await fetch(path, { method: 'GET' });
      const etag = head.headers.get('ETag') || '';
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': etag,
        },
        body: content,
      });
      if (res.status === 412) {
        const current = res.headers.get('ETag') || '';
        showNotification('Restore failed due to concurrent changes. Please retry.', 'error');
        return;
      }
      if (!res.ok) throw new Error('Restore failed');
      showNotification('Restore completed.', 'success');
      // refresh in-memory data
      await loadData();
      buildCalendar(currentYear, currentMonth);
    } catch (e) {
      console.error(e);
      showNotification('Restore error', 'error');
    }
  }

  async function handleBackupNow(which: string) {
    const path = which === 'employees' ? '/api/employees.json' : (which === 'releases' ? '/api/releases.json' : '/api/holidays.json');
    try {
      const getRes = await fetch(path);
      const etag = getRes.headers.get('ETag') || '';
      const body = await getRes.text();
      // POST same content to trigger backup creation
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': etag, 'X-Max-Backups': String((backupConfig as any)?.maxBackups || 10) }, body });
      if (!res.ok) throw new Error(`Backup failed (${res.status})`);
      showNotification('Backup created', 'success');
      await refreshBackupsList();
    } catch (e) {
      console.error(e);
      showNotification('Backup failed', 'error');
    }
  }

  // Restore tab wiring
  const restoreSelect = document.getElementById('restoreFileSelect') as HTMLSelectElement;
  const restoreFileInput = document.getElementById('restoreFileInput') as HTMLInputElement;
  const restorePaste = document.getElementById('restorePaste') as HTMLTextAreaElement;
  const btnDoRestore = document.getElementById('btnDoRestore') as HTMLButtonElement;
  if (restoreFileInput) {
    restoreFileInput.onchange = async () => {
      const f = restoreFileInput.files && restoreFileInput.files[0];
      if (!f) return;
      const text = await f.text();
      restorePaste.value = text;
    };
  }
  if (btnDoRestore) {
    btnDoRestore.onclick = async () => {
      const which = restoreSelect?.value || 'releases';
      const content = restorePaste?.value || '';
      if (!content.trim()) { showNotification('Paste JSON or upload a file first', 'error'); return; }
      // Validate JSON before POST
      try { JSON.parse(content); } catch { showNotification('Invalid JSON provided', 'error'); return; }
      await handleRestore(which, content);
    };
  }

  // Show requested tab
  showTab(initialTab);
  dlg!.style.display = "flex";
}

/**
 * Set up event listeners for buttons and controls
 */
function setupEventListeners() {
  cancelButton.addEventListener("click", closeModal);
  saveButton.addEventListener("click", saveModal);
  removeButton.addEventListener("click", removeRelease);

  // Auto-generate release name when FE or BE tags change
  feTagInput.addEventListener("input", updateReleaseName);
  beTagInput.addEventListener("input", updateReleaseName);
  
  // Update Jira link when ticket input changes
  jiraTicketInput.addEventListener("input", updateJiraLink);
  
  // Auto-set end date when end time is earlier than start time
  endDateTimeInput.addEventListener("change", updateEndDateTime);
  
  // Load Jira tickets when button is clicked
  loadJiraTicketsButton.addEventListener("click", loadJiraTickets);
  
  userStatsCloseButton.addEventListener("click", closeUserStatsModal);

  // Close modal when clicking outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  userStatsModal.addEventListener("click", (e) => {
    if (e.target === userStatsModal) {
      closeUserStatsModal();
    }
  });

  // Close modal with ESC key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modal.style.display === "flex") {
        closeModal();
      }
      if (userStatsModal.style.display === "flex") {
        closeUserStatsModal();
      }
    }
  });

  themeToggle.addEventListener("click", () => {
    if (document.body.classList.contains("dark")) {
      document.body.classList.remove("dark");
      document.body.classList.add("light");
    } else {
      document.body.classList.remove("light");
      document.body.classList.add("dark");
    }
    updateThemeToggleText();
    // Reinitialize tooltips with new theme
    initTippyTooltips();
    console.log("Theme toggled. Current theme:", document.body.classList.contains("dark") ? "dark" : "light");
  });

  setupActionHandlers();
  console.log("All event listeners set up");

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // Go to today
    if (e.key === 't') {
      const today = new Date();
      currentMonth = today.getMonth();
      currentYear = today.getFullYear();
      monthSelect.value = currentMonth.toString();
      yearSelect.value = currentYear.toString();
      buildCalendar(currentYear, currentMonth);
      showNotification("Today", "info");
      return;
    }
    // Prev/Next month
    if (e.key === 'ArrowLeft') {
      const d = new Date(currentYear, currentMonth - 1, 1);
      currentYear = d.getFullYear();
      currentMonth = d.getMonth();
      monthSelect.value = currentMonth.toString();
      yearSelect.value = currentYear.toString();
      buildCalendar(currentYear, currentMonth);
      return;
    }
    if (e.key === 'ArrowRight') {
      const d = new Date(currentYear, currentMonth + 1, 1);
      currentYear = d.getFullYear();
      currentMonth = d.getMonth();
      monthSelect.value = currentMonth.toString();
      yearSelect.value = currentYear.toString();
      buildCalendar(currentYear, currentMonth);
      return;
    }
    // Quick search focus - removed as filter doesn't exist
    // if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
    //   employeeFilter.focus();
    //   e.preventDefault();
    //   return;
    // }
  });
}


/**
 * Set up touch event handlers for mobile devices
 */
function setupTouchEvents() {
  console.log("Setting up touch event handlers");

  // Prevent browser context menu on right-click for mobile
  document.addEventListener('contextmenu', (e) => {
    // Allow default context menu only for debugging in development environments
    const allowBrowserContextMenu = false; // Set to true for debugging
    if (!allowBrowserContextMenu) {
      e.preventDefault();
    }
  });

  // Long press detection on cells for mobile context menu equivalent
  const LONG_PRESS_DURATION = 700; // milliseconds
  let longPressTimer: number | null = null;
  let longPressElement: HTMLElement | null = null;
  let touchMoved = false;

  document.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;
    touchMoved = false;

    // Only apply to day-cell or environment-name elements
    if (!target.classList.contains('day-cell') && !target.classList.contains('environment-name')) {
      return;
    }

    longPressElement = target;

    longPressTimer = window.setTimeout(() => {
      if (!touchMoved && longPressElement) {
        // Trigger the equivalent of a right-click event
        if (longPressElement.classList.contains('day-cell')) {
          // For day-cell elements, simulate context menu
          const username = longPressElement.dataset.username || '';
          const isoDate = longPressElement.dataset.date || '';
          if (username && isoDate) {
            console.log("Long press detected on day cell");
            // Add a visual feedback for the long press
            longPressElement.classList.add('long-press-active');
            setTimeout(() => {
              longPressElement?.classList.remove('long-press-active');
              openModal(username, isoDate, longPressElement as HTMLDivElement);
            }, 150);
          }
        } else if (longPressElement.classList.contains('environment-name')) {
          // For environment-name elements, show user statistics
          const username = longPressElement.dataset.username || '';
          if (username) {
            console.log("Long press detected on employee name");
            // Add visual feedback
            longPressElement.classList.add('long-press-active');
            setTimeout(() => {
              longPressElement?.classList.remove('long-press-active');
              // Create a mock MouseEvent for the showUserStatistics function
              const mockEvent = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: e.touches[0].clientX,
                clientY: e.touches[0].clientY
              });
              showEnvironmentStatistics(username, mockEvent);
            }, 150);
          }
        }

        longPressTimer = null;
      }
    }, LONG_PRESS_DURATION);
  }, { passive: true });

  document.addEventListener('touchmove', () => {
    touchMoved = true;

    // Cancel long press if touch moved
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (longPressElement) {
      longPressElement.classList.remove('long-press-active');
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    // Cancel long press timer if touch ended
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (longPressElement) {
      longPressElement.classList.remove('long-press-active');
      longPressElement = null;
    }
  }, { passive: true });

  // Double-tap detection for mobile
  const DOUBLE_TAP_DELAY = 300; // milliseconds
  let lastTapTime = 0;
  let lastTapElement: HTMLElement | null = null;

  document.addEventListener('touchend', (e) => {
    const target = e.target as HTMLElement;

    // Only apply to day-cell elements that aren't weekends or holidays
    if (!target.classList.contains('day-cell') ||
      target.classList.contains('weekend') ||
      target.classList.contains('holiday') ||
      target.classList.contains('release')) {
      return;
    }

    const currentTime = new Date().getTime();
    const tapDuration = currentTime - lastTapTime;

    if (lastTapElement === target && tapDuration < DOUBLE_TAP_DELAY && !touchMoved) {
      // Double tap detected
      e.preventDefault();

      const username = target.dataset.username || '';
      const isoDate = target.dataset.date || '';

      if (username && isoDate) {
        console.log("Double tap detected on day cell");
        addQuickRelease(username, isoDate, target as HTMLDivElement);
      }

      lastTapElement = null;
      lastTapTime = 0;
    } else {
      // Single tap - record for potential double tap
      lastTapTime = currentTime;
      lastTapElement = target;
    }
  }, { passive: false });

  // Enhanced drag and drop for touch devices
  document.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;

    // Only apply to draggable day-off cells
    if (!target.classList.contains('day-cell') ||
      !target.classList.contains('day-off') ||
      target.getAttribute('draggable') !== 'true') {
      return;
    }

    // Add a visual indicator that the element is draggable
    target.classList.add('touch-draggable');
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    // Remove draggable indicators
    document.querySelectorAll('.touch-draggable').forEach(element => {
      element.classList.remove('touch-draggable');
    });
  }, { passive: true });

  // Ensure horizontal pan inside grid stays within the grid scrolling
  const grid = document.getElementById('environmentList');
  if (grid) {
    grid.addEventListener('touchstart', () => { /* noop */ }, { passive: true });
    // Using CSS touch-action: pan-x on #environmentList handles horizontal panning;
    // we keep JS here minimal to avoid interfering with native scroll.
  }

  // Enhance swipe for action menu for touch devices
  const actionsMenu = document.getElementById('actionsMenu') as HTMLDivElement;
  const backdrop = document.querySelector('.menu-backdrop') as HTMLDivElement;

  if (actionsMenu) {
    // Allow swiping down to close the menu
    let touchStartY = 0;
    let touchMoveY = 0;

    actionsMenu.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    actionsMenu.addEventListener('touchmove', (e) => {
      touchMoveY = e.touches[0].clientY;
      const diffY = touchMoveY - touchStartY;

      // Only allow swiping down, not up
      if (diffY > 0) {
        actionsMenu.style.transform = `translateY(${diffY}px)`;
      }
    }, { passive: true });

    actionsMenu.addEventListener('touchend', () => {
      const diffY = touchMoveY - touchStartY;

      // If swiped down enough, close the menu
      if (diffY > 100) {
        actionsMenu.classList.remove('visible');
        if (backdrop) backdrop.classList.remove('visible');
      }

      // Reset transform
      actionsMenu.style.transform = '';

      // Reset touch values
      touchStartY = 0;
      touchMoveY = 0;
    }, { passive: true });
  }
}

/**
 * Set up action handlers for the unified action button and menu
 */
function setupActionHandlers() {
  // Get DOM elements
  const actionFab = document.getElementById('actionFab') as HTMLDivElement;
  const actionsMenu = document.getElementById('actionsMenu') as HTMLDivElement;
  const todayBtn = document.getElementById('todayBtn') as HTMLButtonElement;
  const actionToggleTheme = document.getElementById('actionToggleTheme') as HTMLDivElement;
  const actionExportData = document.getElementById('actionExportData') as HTMLDivElement;

  // Check if elements exist
  if (!actionFab || !actionsMenu) {
    console.error("Action elements not found");
    return;
  }

  // Create backdrop for menu
  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  document.body.appendChild(backdrop);

  // Open menu when clicking the FAB
  actionFab.addEventListener('click', () => {
    actionsMenu.classList.add('visible');
    backdrop.classList.add('visible');
  });

  // Close menu when clicking the handle
  const closeHandle = actionsMenu.querySelector('.action-close-handle') as HTMLElement;
  if (closeHandle) {
    closeHandle.addEventListener('click', () => {
      actionsMenu.classList.remove('visible');
      backdrop.classList.remove('visible');
    });
  }

  // Close menu when clicking the backdrop
  backdrop.addEventListener('click', () => {
    actionsMenu.classList.remove('visible');
    backdrop.classList.remove('visible');
  });

  // Handle action buttons
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const today = new Date();
      currentMonth = today.getMonth();
      currentYear = today.getFullYear();

      // Update the dropdowns
      monthSelect.value = currentMonth.toString();
      yearSelect.value = currentYear.toString();

      // Rebuild the calendar
      buildCalendar(currentYear, currentMonth);

      // Hide menu
      actionsMenu.classList.remove('visible');
      backdrop.classList.remove('visible');

      showNotification("Calendar set to current month", "info");
    });
  }

  if (actionToggleTheme) {
    actionToggleTheme.addEventListener('click', () => {
      if (document.body.classList.contains("dark")) {
        document.body.classList.remove("dark");
        document.body.classList.add("light");
      } else {
        document.body.classList.remove("light");
        document.body.classList.add("dark");
      }
      updateThemeToggleText();

      // Keep menu state unchanged; this is a header control
    });
  }

  if (actionExportData) {
    actionExportData.addEventListener('click', () => {
      // Open unified operations dialog (default to export)
      showOperationsDialog("export");
      // Hide menu
      actionsMenu.classList.remove('visible');
      backdrop.classList.remove('visible');
    });
  }

  // Handle ESC key to close menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && actionsMenu.classList.contains('visible')) {
      actionsMenu.classList.remove('visible');
      backdrop.classList.remove('visible');
    }
  });
}

/**
 * Initialize the application.
 */
async function initApp() {
  console.log("Initializing application...");

  // First get DOM elements
  getDOMElements();

  // Load backup settings before loading data
  await loadBackupSettings();

  // Then load data
  const dataLoaded = await loadData();
  if (!dataLoaded) {
    console.error("Failed to load data, cannot initialize application");
    return;
  }

  // Set up controls
  initControls();

  // Set up event listeners
  setupEventListeners();

  // Set up touch events
  setupTouchEvents();

  // Set up cutom tooltip system
  initTooltipSystem()

  // Update theme toggle text
  updateThemeToggleText();

  // Initialize calendar with current month/year
  buildCalendar(currentYear, currentMonth);

  // Add view toggle button
  addViewToggleButton();

  // Add window resize listener for dynamic cell sizing
  window.addEventListener('resize', () => {
    setTimeout(() => {
      applyDynamicCellSizing();
    }, 100); // Debounce resize events
  });

    // Remove legacy settings button injection (unified dialog handles everything)

  console.log("Application initialized successfully");
}

/**
 * Update theme toggle button text based on current theme
 */
function updateThemeToggleText() {
  if (themeToggle) {
    themeToggle.textContent = document.body.classList.contains("dark") ? "light" : "dark";
  }
}

/**
 * Helper: Parse a date string "YYYY-MM-DD" from the JSON as a local Date.
 */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Month is 0-indexed in the Date constructor.
  return new Date(year, month - 1, day);
}

/**
 * Helper: Generate a local date string ("YYYY-MM-DD") from a Date object.
 */
function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Modified getHoliday that compares the JSON date (parsed as local) with the cell date.
 */
function getHoliday(isoDate: string): Holiday | null {
  const targetDate = parseLocalDate(isoDate);
  for (const holiday of holidaysData.holidays) {
    const holidayDate = parseLocalDate(holiday.date);
    if (
      holidayDate.getFullYear() === targetDate.getFullYear() &&
      holidayDate.getMonth() === targetDate.getMonth() &&
      holidayDate.getDate() === targetDate.getDate()
    ) {
      return holiday;
    }
  }
  return null;
}

/**
 * Get all DOM elements after ensuring the document is loaded.
 */
function getDOMElements() {
  console.log("Getting DOM elements");

  // These elements should all exist now
  monthSelect = document.getElementById("monthSelect") as HTMLSelectElement;
  yearSelect = document.getElementById("yearSelect") as HTMLSelectElement;
  environmentListDiv = document.getElementById("environmentList") as HTMLDivElement;
  modal = document.getElementById("modal") as HTMLDivElement;
  releaseStatusSelect = document.getElementById("releaseStatus") as HTMLSelectElement;
  feTagInput = document.getElementById("feTag") as HTMLInputElement;
  beTagInput = document.getElementById("beTag") as HTMLInputElement;
  releaseNameInput = document.getElementById("releaseName") as HTMLInputElement;
  jiraTicketInput = document.getElementById("jiraTicket") as HTMLInputElement;
  jiraLink = document.getElementById("jiraLink") as HTMLAnchorElement;
  loadJiraTicketsButton = document.getElementById("loadJiraTickets") as HTMLButtonElement;
  jiraTicketsList = document.getElementById("jiraTicketsList") as HTMLDivElement;
  ticketsContainer = document.getElementById("ticketsContainer") as HTMLDivElement;
  startTimeInput = document.getElementById("startTime") as HTMLInputElement;
  endDateTimeInput = document.getElementById("endDateTime") as HTMLInputElement;
  dependsOnSelect = document.getElementById("dependsOn") as HTMLSelectElement;
  
  // Initialize Flatpickr for time and datetime inputs
  flatpickr(startTimeInput, {
    enableTime: true,
    noCalendar: true,
    dateFormat: "H:i",
    time_24hr: true,
    defaultDate: "20:00"
  });
  
  // Store reference to endDateTime flatpickr instance
  (window as any).endDateTimeFlatpickr = flatpickr(endDateTimeInput, {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    time_24hr: true,
    allowInput: true
  });
  
  cancelButton = document.getElementById("cancelButton") as HTMLButtonElement;
  saveButton = document.getElementById("saveButton") as HTMLButtonElement;
  removeButton = document.getElementById("removeButton") as HTMLButtonElement;
  holidayInfo = document.getElementById("holidayInfo") as HTMLDivElement;
  editableArea = document.getElementById("editableArea") as HTMLDivElement;
  themeToggle = document.getElementById("themeToggle") as HTMLDivElement;

  // New filter controls
  // Filter elements removed - not used

  // Quick actions elements
  quickActions = document.getElementById("quickActions") as HTMLDivElement;
  actionShowToday = document.getElementById("actionShowToday") as HTMLDivElement;
  actionToggleTheme = document.getElementById("actionToggleTheme") as HTMLDivElement;
  actionExportData = document.getElementById("actionExportData") as HTMLDivElement;

  // User stats modal elements
  userStatsModal = document.getElementById("userStatsModal") as HTMLDivElement;
  userStatsName = document.getElementById("userStatsName") as HTMLDivElement;
  userStatsContent = document.getElementById("userStatsContent") as HTMLDivElement;
  userStatsCloseButton = document.getElementById("userStatsCloseButton") as HTMLButtonElement;

  // Verify that the elements were found
  if (!monthSelect || !yearSelect || !environmentListDiv) {
    console.error("Critical DOM elements not found!", {
      monthSelect,
      yearSelect,
      environmentListDiv
    });
  } else {
    console.log("All critical DOM elements found");
  }

  // Filter elements removed - not used

  // Check that we found modal elements
  if (!releaseStatusSelect || !feTagInput || !beTagInput || !releaseNameInput || 
      !jiraTicketInput || !startTimeInput || !endDateTimeInput || !dependsOnSelect || 
      !saveButton || !removeButton) {
    console.error("Modal elements not found!", {
      releaseStatusSelect,
      feTagInput,
      beTagInput,
      releaseNameInput,
      jiraTicketInput,
      startTimeInput,
      endDateTimeInput,
      dependsOnSelect,
      saveButton,
      removeButton
    });
  }

  // Check that we found user stats elements
  if (!userStatsModal || !userStatsName || !userStatsContent || !userStatsCloseButton) {
    console.error("User stats modal elements not found!");
  }
}

/**
 * Initialize the month and year selectors.
 * Loads the last saved selection from local storage (if available) or uses today's date.
 */
function initControls() {
  const today = new Date();
  // Temporarily ignore localStorage.
  currentYear = today.getFullYear();
  currentMonth = today.getMonth();

  console.log("Init Controls (no localStorage): currentYear =", currentYear, "currentMonth =", currentMonth);

  // Clear existing options first to avoid duplicates when reinitializing
  monthSelect.innerHTML = "";
  yearSelect.innerHTML = "";

  // Populate month selector.
  for (let m = 0; m < 12; m++) {
    const option = document.createElement("option");
    option.value = m.toString();
    option.text = new Date(0, m).toLocaleString("default", { month: "long" });
    if (m === currentMonth) {
      option.selected = true;
    }
    monthSelect.appendChild(option);
  }

  // Populate year selector.
  for (let y = today.getFullYear() - 5; y <= today.getFullYear() + 5; y++) {
    const option = document.createElement("option");
    option.value = y.toString();
    option.text = y.toString();
    if (y === currentYear) {
      option.selected = true;
    }
    yearSelect.appendChild(option);
  }

  // Filter functionality removed - not used

  // Remove any existing event listeners (to prevent duplicates)
  monthSelect.removeEventListener("change", handleMonthChange);
  yearSelect.removeEventListener("change", handleYearChange);

  // Attach event listeners.
  monthSelect.addEventListener("change", handleMonthChange);
  yearSelect.addEventListener("change", handleYearChange);

  console.log("Event listeners attached to dropdowns");

  // Move the action FAB into the controls bar, left of the month selector
  const actionFabEl = document.getElementById('actionFab') as HTMLDivElement | null;
  const controls = document.getElementById('controls') as HTMLDivElement | null;
  if (actionFabEl && controls && monthSelect) {
    actionFabEl.classList.add('inline-action-fab');
    // Clear any inline/fallback positioning that might keep it fixed
    actionFabEl.style.position = 'static';
    actionFabEl.style.bottom = '';
    actionFabEl.style.right = '';
    actionFabEl.style.left = '';
    actionFabEl.style.top = '';
    (actionFabEl as any).style.inset = '';
    // Insert before monthSelect
    // Place action button at the far left, before month; Today button should come immediately after the FAB
    controls.insertBefore(actionFabEl, monthSelect);
    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) {
      controls.insertBefore(todayBtn, monthSelect);
    }
  }
}

/**
 * Initialize the team/department filter dropdown - removed as teamFilter doesn't exist
 */
function initTeamFilter() {
  // Function removed as teamFilter element doesn't exist
  console.log("Team filter initialization skipped - element not found");
}

/**
 * Handle month selection change
 */
function handleMonthChange() {
  console.log("Month dropdown change triggered. New value:", monthSelect.value);
  currentMonth = parseInt(monthSelect.value, 10);
  buildCalendar(currentYear, currentMonth);
}

/**
 * Handle year selection change
 */
function handleYearChange() {
  console.log("Year dropdown change triggered. New value:", yearSelect.value);
  currentYear = parseInt(yearSelect.value, 10);
  buildCalendar(currentYear, currentMonth);
}

/**
 * Handle employee name filter change
 */
// Filter functions removed - not used

/**
 * Build dependency row for an environment
 */
function buildDependencyRow(environment: string, year: number, month: number, daysInMonth: number) {
  const row = document.createElement("div");
  row.classList.add("row", "dependency-row");
  row.dataset.environment = environment;
  row.dataset.type = "dependency";

  const nameDiv = document.createElement("div");
  nameDiv.classList.add("environment-name", "dependency-name");
  nameDiv.textContent = "Dependencies";
  nameDiv.dataset.environment = environment;
  nameDiv.title = `Dependencies for ${environment}`;
  row.appendChild(nameDiv);

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.classList.add("day-cell", "dependency-cell");
    const cellDate = new Date(year, month, day);
    const isoDate = getLocalDateString(cellDate);
    cell.dataset.date = isoDate;
    cell.dataset.environment = environment;
    cell.textContent = "";

    // Check if this cell should be colored based on dependencies
    const environmentReleases = releasesData[environment] || [];
    const releaseEntry = environmentReleases.find((entry) => entry.date === isoDate);
    
    if (releaseEntry && releaseEntry.dependsOn) {
      // This release has a dependency, color the dependency cell
      const [depEnv, depDate] = releaseEntry.dependsOn.split(':');
      const depReleases = releasesData[depEnv] || [];
      const depRelease = depReleases.find((entry) => entry.date === depDate);
      
      if (depRelease) {
        // Both releases exist, color the dependency cell
        cell.style.backgroundColor = "#4a90e2"; // Blue color for dependencies
        cell.style.color = "#ffffff";
        cell.classList.add("dependency-connected");
        
        // Set tooltip with dependent release details
        let depTooltipParts = [`Depends on: ${depEnv} - ${depDate}`];
        if (depRelease.releaseName) {
          depTooltipParts.push(`Release: ${depRelease.releaseName}`);
        }
        if (depRelease.jiraTicket) {
          depTooltipParts.push(`Jira: ${depRelease.jiraTicket}`);
        }
        if (depRelease.startTime && depRelease.endDateTime) {
          const endDate = depRelease.endDateTime.split('T')[0];
          const endTime = depRelease.endDateTime.split('T')[1];
          if (endDate !== depRelease.date) {
            depTooltipParts.push(`Time: ${depRelease.startTime} (${depRelease.date}) - ${endTime} (${endDate})`);
          } else {
            depTooltipParts.push(`Time: ${depRelease.startTime}-${endTime}`);
          }
        }
        if (depRelease.note) {
          depTooltipParts.push(`Note: ${depRelease.note}`);
        }
        cell.setAttribute('data-tooltip', depTooltipParts.join('\n'));
      }
    }

    row.appendChild(cell);
  }

  return row;
}

/**
 * Build the calendar grid based on the selected month and year.
 */
function buildCalendar(year, month) {
  console.log("Building calendar for Year:", year, "Month:", month);
  if (!environmentsData || !environmentsData.environments || !environmentListDiv) {
    console.error("Missing required data or DOM elements for building calendar", {
      hasEmployeesData: !!environmentsData,
      hasEnvironments: !!(environmentsData && environmentsData.environments),
      hasEmployeeListDiv: !!environmentListDiv
    });
    return;
  }

  environmentListDiv.innerHTML = "";
  console.log(`Building calendar with year=${year}, month=${month} (${new Date(year, month, 1).toLocaleString("default", { month: "long" })})`);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Precompute percent off per day for visible environments
  const percentByDay: number[] = [];
  const visibleEnvironments = environmentsData.environments.filter(e => e.visible).map(e => e.name);
  for (let day = 1; day <= daysInMonth; day++) {
    const isoDate = getLocalDateString(new Date(year, month, day));
    const total = visibleEnvironments.length;
    let off = 0;
    visibleEnvironments.forEach(env => {
      const arr = releasesData[env] || [];
      if (arr.some(e => e.date === isoDate)) off += 1;
    });
    percentByDay.push(total > 0 ? Math.round((off / total) * 100) : 0);
  }

  // Create header row
  const headerRow = document.createElement("div");
  headerRow.classList.add("row");

  const emptyCell = document.createElement("div");
  emptyCell.classList.add("environment-name");
  emptyCell.textContent = "";
  headerRow.appendChild(emptyCell);

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const isoDate = getLocalDateString(cellDate);
    const cell = document.createElement("div");
    cell.classList.add("day-cell", "header-cell");
    cell.textContent = day.toString();
    const now = new Date();
    if (cellDate.getFullYear() === now.getFullYear() && cellDate.getMonth() === now.getMonth() && cellDate.getDate() === now.getDate()) {
      cell.classList.add('today');
    }
    if (cellDate.getDay() === 0 || cellDate.getDay() === 6) {
      cell.classList.add("weekend");
    }
    // Add capacity info as a tooltip on header cell
    const pct = percentByDay[day - 1] || 0;
    cell.setAttribute('data-tooltip', `Capacity: ${pct}% off`);
    headerRow.appendChild(cell);
  }

  environmentListDiv.appendChild(headerRow);

  const filteredEnvironments = environmentsData.environments.filter((environment) => environment.visible);

  if (filteredEnvironments.length === 0) {
    const noResultsDiv = document.createElement("div");
    noResultsDiv.classList.add("no-results-message");
    noResultsDiv.textContent = "No environments available";
    environmentListDiv.appendChild(noResultsDiv);
    return;
  }

  filteredEnvironments.forEach((environment) => {
    const row = document.createElement("div");
    row.classList.add("row");
    row.dataset.environment = environment.name;

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("environment-name");
    nameDiv.textContent = environment.displayName;
    nameDiv.dataset.environment = environment.name;

    nameDiv.title = `Environment: ${environment.displayName}`;

    // Add right-click functionality to show environment statistics
    nameDiv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      console.log("Right-clicked on environment:", environment.name);
      showEnvironmentStatistics(environment.name, e);
    });

    row.appendChild(nameDiv);

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.classList.add("day-cell");
      const cellDate = new Date(year, month, day);
      const isoDate = getLocalDateString(cellDate);
      cell.dataset.date = isoDate;
      cell.dataset.environment = environment.name;
      cell.textContent = "";

      if (cellDate.getDay() === 0 || cellDate.getDay() === 6) {
        cell.classList.add("weekend");
      }

      const holiday = getHoliday(isoDate);
      if (holiday) {
        cell.style.backgroundColor = "#885555";
        cell.style.color = "#000000";
        cell.setAttribute('data-tooltip', holiday.name);
        cell.classList.add("holiday");
      } else {
        const environmentReleases = releasesData[environment.name] || [];
        const releaseEntry = environmentReleases.find((entry) => entry.date === isoDate);

        if (releaseEntry) {
          // Environment has release
          const statusConfig = environmentsData.releaseStatuses[releaseEntry.status];
          cell.style.backgroundColor = statusConfig.background;
          cell.style.color = statusConfig.foreground;

          // Set tooltip with data-tooltip attribute
          let tooltipParts = [`${environment.name} - ${releaseEntry.status}`];
          if (releaseEntry.releaseName) tooltipParts.push(`Release: ${releaseEntry.releaseName}`);
          if (releaseEntry.jiraTicket) {
            if (isValidJiraTicket(releaseEntry.jiraTicket)) {
              tooltipParts.push(`Jira: ${releaseEntry.jiraTicket} (click to open)`);
            } else {
              tooltipParts.push(`Jira: ${releaseEntry.jiraTicket}`);
            }
          }
          if (releaseEntry.startTime && releaseEntry.endDateTime) {
            const endDate = releaseEntry.endDateTime.split('T')[0];
            const endTime = releaseEntry.endDateTime.split('T')[1];
            if (endDate !== releaseEntry.date) {
              tooltipParts.push(`Time: ${releaseEntry.startTime} (${releaseEntry.date}) - ${endTime} (${endDate})`);
            } else {
              tooltipParts.push(`Time: ${releaseEntry.startTime}-${endTime}`);
            }
          }
          if (releaseEntry.note) tooltipParts.push(`Note: ${releaseEntry.note}`);
          cell.setAttribute('data-tooltip', tooltipParts.join('\n'));

          cell.classList.add("release");
          cell.dataset.status = releaseEntry.status;
          cell.setAttribute("draggable", "true");
          setupDragEvents(cell, environment.name, releaseEntry);
        } else {
          // No release, regular cell
          if (cellDate.getDay() !== 0 && cellDate.getDay() !== 6) {
            setupDropTarget(cell, environment.name, isoDate);
          }
        }
      }

      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        console.log("Opening modal for", environment.name, isoDate);
        openModal(environment.name, isoDate, cell);
      });

      cell.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (!cell.classList.contains("weekend") &&
          !cell.classList.contains("holiday") &&
          !cell.classList.contains("release")) {
          console.log("Double-click adding release for", environment.name, isoDate);
          addQuickRelease(environment.name, isoDate, cell);
        }
      });

      row.appendChild(cell);
    }

    environmentListDiv.appendChild(row);
    
    // Add dependency row for this environment
    const dependencyRow = buildDependencyRow(environment.name, year, month, daysInMonth);
    environmentListDiv.appendChild(dependencyRow);
  });

  console.log("Calendar built successfully for", year, month);
  
  // Apply dynamic cell sizing
  applyDynamicCellSizing();
  
  // Re-initialize tooltip system for new cells
  initTooltipSystem();
}

/**
 * Initialize continuous view mode
 */
function initContinuousView() {
  continuousViewMode = true;
  
  // Set start date to the first day of the current month
  continuousViewStartDate = new Date(currentYear, currentMonth, 1);
  
  // Calculate actual number of days in the current month
  visibleDays = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Keep controls visible but add continuous view indicator
  addDateRangeIndicator();

  // Build continuous calendar
  buildContinuousCalendar();

  // Setup drag/swipe functionality
  setupContinuousViewDrag();
}

/**
 * Build the continuous calendar view with actual month days visible
 */
function buildContinuousCalendar() {
  console.log("Building continuous calendar starting from:", continuousViewStartDate);
  
  if (!environmentsData || !environmentsData.environments || !environmentListDiv) {
    console.error("Missing required data or DOM elements for building continuous calendar");
    return;
  }

  environmentListDiv.innerHTML = "";
  environmentListDiv.classList.add("continuous-view");

  // Create header row
  const headerRow = document.createElement("div");
  headerRow.classList.add("row", "continuous-header");

  const emptyCell = document.createElement("div");
  emptyCell.classList.add("environment-name");
  emptyCell.textContent = "";
  headerRow.appendChild(emptyCell);

  // Create 40 day cells
  for (let i = 0; i < visibleDays; i++) {
    const cellDate = new Date(continuousViewStartDate);
    cellDate.setDate(cellDate.getDate() + i);
    const isoDate = getLocalDateString(cellDate);
    
    const cell = document.createElement("div");
    cell.classList.add("day-cell", "header-cell", "continuous-day");
    cell.textContent = cellDate.getDate().toString();
    cell.dataset.date = isoDate;
    
    // Add month/year info for first day of month
    if (cellDate.getDate() === 1) {
      const monthYear = cellDate.toLocaleDateString("default", { month: "short", year: "2-digit" });
      cell.setAttribute('data-month-year', monthYear);
    }
    
    const now = new Date();
    if (cellDate.getFullYear() === now.getFullYear() && 
        cellDate.getMonth() === now.getMonth() && 
        cellDate.getDate() === now.getDate()) {
      cell.classList.add('today');
    }
    
    if (cellDate.getDay() === 0 || cellDate.getDay() === 6) {
      cell.classList.add("weekend");
    }
    
    // Calculate capacity for this day
    const visibleEnvironments = environmentsData.environments.filter(e => e.visible).map(e => e.name);
    const total = visibleEnvironments.length;
    let off = 0;
    visibleEnvironments.forEach(env => {
      const arr = releasesData[env] || [];
      if (arr.some(e => e.date === isoDate)) off += 1;
    });
    const pct = total > 0 ? Math.round((off / total) * 100) : 0;
    cell.setAttribute('data-tooltip', `Capacity: ${pct}% off`);
    
    headerRow.appendChild(cell);
  }

  environmentListDiv.appendChild(headerRow);

  const filteredEnvironments = environmentsData.environments.filter((environment) => environment.visible);

  if (filteredEnvironments.length === 0) {
    const noResultsDiv = document.createElement("div");
    noResultsDiv.classList.add("no-results-message");
    noResultsDiv.textContent = "No environments available";
    environmentListDiv.appendChild(noResultsDiv);
    return;
  }

  // Create environment rows
  filteredEnvironments.forEach((environment) => {
    const row = document.createElement("div");
    row.classList.add("row", "continuous-row");
    row.dataset.environment = environment.name;

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("environment-name");
    nameDiv.textContent = environment.displayName;
    nameDiv.dataset.environment = environment.name;
    nameDiv.title = `Environment: ${environment.displayName}`;

    // Add right-click functionality
    nameDiv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showEnvironmentStatistics(environment.name, e);
    });

    row.appendChild(nameDiv);

    // Create 40 day cells for this environment
    for (let i = 0; i < visibleDays; i++) {
      const cellDate = new Date(continuousViewStartDate);
      cellDate.setDate(cellDate.getDate() + i);
      const isoDate = getLocalDateString(cellDate);
      
      const cell = document.createElement("div");
      cell.classList.add("day-cell", "continuous-day");
      cell.dataset.date = isoDate;
      cell.dataset.environment = environment.name;
      cell.textContent = "";

      if (cellDate.getDay() === 0 || cellDate.getDay() === 6) {
        cell.classList.add("weekend");
      }

      // Add today class if this is today
      const now = new Date();
      if (cellDate.getFullYear() === now.getFullYear() && 
          cellDate.getMonth() === now.getMonth() && 
          cellDate.getDate() === now.getDate()) {
        cell.classList.add('today');
      }

      // Load data for this day on demand
      loadDayData(environment.name, isoDate, cell);

      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openModal(environment.name, isoDate, cell);
      });

      cell.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (!cell.classList.contains("weekend") &&
          !cell.classList.contains("holiday") &&
          !cell.classList.contains("release")) {
          addQuickRelease(environment.name, isoDate, cell);
        }
      });

      row.appendChild(cell);
    }

    environmentListDiv.appendChild(row);
    
    // Add dependency row for this environment
    const dependencyRow = buildContinuousDependencyRow(environment.name);
    environmentListDiv.appendChild(dependencyRow);
  });

  console.log("Continuous calendar built successfully");
  
  // Apply dynamic cell sizing
  applyDynamicCellSizing();
  
  // Update date range indicator
  updateDateRangeIndicator();
  
  // Re-initialize tooltip system
  initTooltipSystem();
}

/**
 * Load data for a specific day on demand
 */
function loadDayData(environment: string, isoDate: string, cell: HTMLDivElement) {
  // Load holiday data first
  const holiday = getHoliday(isoDate);
  if (holiday) {
    cell.style.backgroundColor = "#885555";
    cell.style.color = "#000000";
    cell.setAttribute('data-tooltip', holiday.name);
    cell.classList.add("holiday");
    return;
  }
  
  // Load release data
  const environmentReleases = releasesData[environment] || [];
  const releaseEntry = environmentReleases.find((entry) => entry.date === isoDate);

  if (releaseEntry) {
    const statusConfig = environmentsData.releaseStatuses[releaseEntry.status];
    cell.style.backgroundColor = statusConfig.background;
    cell.style.color = statusConfig.foreground;

    // Set tooltip
    let tooltipParts = [`${environment} - ${releaseEntry.status}`];
    if (releaseEntry.releaseName) tooltipParts.push(`Release: ${releaseEntry.releaseName}`);
    if (releaseEntry.jiraTicket) {
      if (isValidJiraTicket(releaseEntry.jiraTicket)) {
        tooltipParts.push(`Jira: ${releaseEntry.jiraTicket} (click to open)`);
      } else {
        tooltipParts.push(`Jira: ${releaseEntry.jiraTicket}`);
      }
    }
    if (releaseEntry.startTime && releaseEntry.endDateTime) {
      const endDate = releaseEntry.endDateTime.split('T')[0];
      const endTime = releaseEntry.endDateTime.split('T')[1];
      if (endDate !== releaseEntry.date) {
        tooltipParts.push(`Time: ${releaseEntry.startTime} (${releaseEntry.date}) - ${endTime} (${endDate})`);
      } else {
        tooltipParts.push(`Time: ${releaseEntry.startTime}-${endTime}`);
      }
    }
    if (releaseEntry.note) tooltipParts.push(`Note: ${releaseEntry.note}`);
    cell.setAttribute('data-tooltip', tooltipParts.join('\n'));

    cell.classList.add("release");
    cell.dataset.status = releaseEntry.status;
    cell.setAttribute("draggable", "true");
    setupDragEvents(cell, environment, releaseEntry);
  } else {
    // No release, regular cell
    const cellDate = new Date(isoDate);
    if (cellDate.getDay() !== 0 && cellDate.getDay() !== 6) {
      setupDropTarget(cell, environment, isoDate);
    }
  }
}

/**
 * Build dependency row for continuous view
 */
function buildContinuousDependencyRow(environment: string) {
  const row = document.createElement("div");
  row.classList.add("row", "continuous-row", "dependency-row");
  row.dataset.environment = environment;
  row.dataset.type = "dependency";

  const nameDiv = document.createElement("div");
  nameDiv.classList.add("environment-name", "dependency-name");
  nameDiv.textContent = "Dependencies";
  nameDiv.dataset.environment = environment;
  nameDiv.title = `Dependencies for ${environment}`;
  row.appendChild(nameDiv);

  // Create 40 day cells for dependencies
  for (let i = 0; i < visibleDays; i++) {
    const cellDate = new Date(continuousViewStartDate);
    cellDate.setDate(cellDate.getDate() + i);
    const isoDate = getLocalDateString(cellDate);
    
    const cell = document.createElement("div");
    cell.classList.add("day-cell", "continuous-day", "dependency-cell");
    cell.dataset.date = isoDate;
    cell.dataset.environment = environment;
    cell.textContent = "";

    if (cellDate.getDay() === 0 || cellDate.getDay() === 6) {
      cell.classList.add("weekend");
    }

    // Add today class if this is today
    const now = new Date();
    if (cellDate.getFullYear() === now.getFullYear() && 
        cellDate.getMonth() === now.getMonth() && 
        cellDate.getDate() === now.getDate()) {
      cell.classList.add('today');
    }

    // Check if this cell should be colored based on dependencies
    const environmentReleases = releasesData[environment] || [];
    const releaseEntry = environmentReleases.find((entry) => entry.date === isoDate);
    
    if (releaseEntry && releaseEntry.dependsOn) {
      // This release has a dependency, color the dependency cell
      const [depEnv, depDate] = releaseEntry.dependsOn.split(':');
      const depReleases = releasesData[depEnv] || [];
      const depRelease = depReleases.find((entry) => entry.date === depDate);
      
      if (depRelease) {
        // Both releases exist, color the dependency cell
        cell.style.backgroundColor = "#4a90e2"; // Blue color for dependencies
        cell.style.color = "#ffffff";
        cell.classList.add("dependency-connected");
        
        // Set tooltip with dependent release details
        let depTooltipParts = [`Depends on: ${depEnv} - ${depDate}`];
        if (depRelease.releaseName) {
          depTooltipParts.push(`Release: ${depRelease.releaseName}`);
        }
        if (depRelease.jiraTicket) {
          depTooltipParts.push(`Jira: ${depRelease.jiraTicket}`);
        }
        if (depRelease.startTime && depRelease.endDateTime) {
          const endDate = depRelease.endDateTime.split('T')[0];
          const endTime = depRelease.endDateTime.split('T')[1];
          if (endDate !== depRelease.date) {
            depTooltipParts.push(`Time: ${depRelease.startTime} (${depRelease.date}) - ${endTime} (${endDate})`);
          } else {
            depTooltipParts.push(`Time: ${depRelease.startTime}-${endTime}`);
          }
        }
        if (depRelease.note) {
          depTooltipParts.push(`Note: ${depRelease.note}`);
        }
        cell.setAttribute('data-tooltip', depTooltipParts.join('\n'));
      }
    }

    row.appendChild(cell);
  }

  return row;
}

/**
 * Setup drag/swipe functionality for continuous view - like a scrollable window
 */
function setupContinuousViewDrag() {
  let isDragging = false;
  let startX = 0;
  let currentX = 0;
  let scrollOffset = 0; // Current scroll position in pixels
  let velocity = 0;
  let lastX = 0;
  let lastTime = 0;
  let animationId: number | null = null;
  
  const calendarContainer = environmentListDiv;
  const dayWidth = 40; // Width of each day cell
  
  // Remove any existing event listeners to prevent duplicates
  calendarContainer.removeEventListener('mousedown', handleMouseDown);
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  calendarContainer.removeEventListener('touchstart', handleTouchStart);
  calendarContainer.removeEventListener('touchmove', handleTouchMove);
  calendarContainer.removeEventListener('touchend', handleTouchEnd);
  
  // Mouse event handlers
  function handleMouseDown(e: MouseEvent) {
    isDragging = true;
    startX = e.clientX;
    lastX = e.clientX;
    lastTime = Date.now();
    velocity = 0;
    calendarContainer.style.cursor = 'grabbing';
    calendarContainer.classList.add('dragging');
    
    // Stop any ongoing animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    e.preventDefault();
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    
    currentX = e.clientX;
    const deltaX = currentX - lastX;
    const currentTime = Date.now();
    const deltaTime = currentTime - lastTime;
    
    // Calculate velocity for momentum
    if (deltaTime > 0) {
      velocity = deltaX / deltaTime;
    }
    
    // Update scroll offset
    scrollOffset += deltaX;
    
    // Apply transform to all continuous rows
    const rows = calendarContainer.querySelectorAll('.continuous-row, .continuous-header');
    rows.forEach(row => {
      (row as HTMLElement).style.transform = `translateX(${scrollOffset}px)`;
    });
    
    // Update date range indicator to show current position
    updateScrollIndicator();
    
    lastX = currentX;
    lastTime = currentTime;
  }
  
  function handleMouseUp() {
    if (!isDragging) return;
    
    isDragging = false;
    calendarContainer.style.cursor = 'grab';
    calendarContainer.classList.remove('dragging');
    
    // Apply momentum scrolling
    if (Math.abs(velocity) > 0.1) {
      applyMomentum();
    } else {
      // Snap to nearest day boundary
      snapToDayBoundary();
    }
  }
  
  // Touch event handlers
  function handleTouchStart(e: TouchEvent) {
    isDragging = true;
    startX = e.touches[0].clientX;
    lastX = e.touches[0].clientX;
    lastTime = Date.now();
    velocity = 0;
    calendarContainer.classList.add('dragging');
    
    // Stop any ongoing animation
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    e.preventDefault();
  }
  
  function handleTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    
    currentX = e.touches[0].clientX;
    const deltaX = currentX - lastX;
    const currentTime = Date.now();
    const deltaTime = currentTime - lastTime;
    
    // Calculate velocity for momentum
    if (deltaTime > 0) {
      velocity = deltaX / deltaTime;
    }
    
    // Update scroll offset
    scrollOffset += deltaX;
    
    // Apply transform to all continuous rows
    const rows = calendarContainer.querySelectorAll('.continuous-row, .continuous-header');
    rows.forEach(row => {
      (row as HTMLElement).style.transform = `translateX(${scrollOffset}px)`;
    });
    
    // Update date range indicator to show current position
    updateScrollIndicator();
    
    lastX = currentX;
    lastTime = currentTime;
    
    e.preventDefault();
  }
  
  function handleTouchEnd() {
    if (!isDragging) return;
    
    isDragging = false;
    calendarContainer.classList.remove('dragging');
    
    // Apply momentum scrolling
    if (Math.abs(velocity) > 0.1) {
      applyMomentum();
    } else {
      // Snap to nearest day boundary
      snapToDayBoundary();
    }
  }
  
  function applyMomentum() {
    const friction = 0.95; // Friction coefficient
    const minVelocity = 0.01; // Minimum velocity to continue scrolling
    
    function animate() {
      if (Math.abs(velocity) < minVelocity) {
        // Stop and snap to day boundary
        snapToDayBoundary();
        return;
      }
      
      // Apply velocity
      scrollOffset += velocity * 16; // 16ms frame time
      velocity *= friction;
      
      // Apply transform
      const rows = calendarContainer.querySelectorAll('.continuous-row, .continuous-header');
      rows.forEach(row => {
        (row as HTMLElement).style.transform = `translateX(${scrollOffset}px)`;
      });
      
      // Update indicator
      updateScrollIndicator();
      
      // Continue animation
      animationId = requestAnimationFrame(animate);
    }
    
    animationId = requestAnimationFrame(animate);
  }
  
  function snapToDayBoundary() {
    // Calculate how many days to move based on current scroll offset
    // Reverse the direction: positive scroll offset should go to past (left drag)
    const daysToMove = -Math.round(scrollOffset / dayWidth);
    
    if (Math.abs(daysToMove) >= 1) {
      // Move the start date
      continuousViewStartDate.setDate(continuousViewStartDate.getDate() + daysToMove);
      
      // Reset scroll offset
      scrollOffset = 0;
      
      // Rebuild calendar with new start date
      buildContinuousCalendar();
    } else {
      // Snap back to original position
      scrollOffset = 0;
      const rows = calendarContainer.querySelectorAll('.continuous-row, .continuous-header');
      rows.forEach(row => {
        (row as HTMLElement).style.transition = 'transform 0.3s ease';
        (row as HTMLElement).style.transform = 'translateX(0px)';
      });
      
      // Reset indicator
      updateDateRangeIndicator();
    }
  }
  
  function updateScrollIndicator() {
    const indicator = document.getElementById('dateRangeIndicator');
    if (!indicator) return;
    
    // Calculate current visible range based on scroll offset
    // Reverse the direction for logical behavior
    const daysScrolled = -scrollOffset / dayWidth;
    const currentStartDate = new Date(continuousViewStartDate);
    currentStartDate.setDate(currentStartDate.getDate() + Math.floor(daysScrolled));
    
    const currentEndDate = new Date(currentStartDate);
    currentEndDate.setDate(currentEndDate.getDate() + visibleDays - 1);
    
    const startStr = currentStartDate.toLocaleDateString('default', { 
      month: 'short', 
      day: 'numeric' 
    });
    const endStr = currentEndDate.toLocaleDateString('default', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    
    indicator.textContent = `${startStr} - ${endStr} (${visibleDays} days)`;
    indicator.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';
  }
  
  // Add event listeners
  calendarContainer.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  calendarContainer.addEventListener('touchstart', handleTouchStart);
  calendarContainer.addEventListener('touchmove', handleTouchMove);
  calendarContainer.addEventListener('touchend', handleTouchEnd);
  
  // Set initial cursor
  calendarContainer.style.cursor = 'grab';
  
  // Add keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!continuousViewMode) return;
    
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      // Move left by 1 day
      continuousViewStartDate.setDate(continuousViewStartDate.getDate() - 1);
      buildContinuousCalendar();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      // Move right by 1 day
      continuousViewStartDate.setDate(continuousViewStartDate.getDate() + 1);
      buildContinuousCalendar();
    } else if (e.key === 'Home') {
      e.preventDefault();
      // Go to today
      continuousViewStartDate = new Date();
      continuousViewStartDate.setDate(continuousViewStartDate.getDate() - Math.floor(visibleDays / 2));
      buildContinuousCalendar();
    }
  });
  
  // Add window resize listener for dynamic cell sizing
  window.addEventListener('resize', () => {
    setTimeout(() => {
      applyDynamicCellSizing();
    }, 100); // Debounce resize events
  });
}

/**
 * Add view toggle button to switch between traditional and continuous views
 */
function addViewToggleButton() {
  const controls = document.getElementById('controls');
  if (!controls) return;
  
  const toggleButton = document.createElement('button');
  toggleButton.id = 'viewToggle';
  toggleButton.textContent = 'Continuous View';
  toggleButton.title = 'Switch to continuous 40-day view';
  toggleButton.style.cssText = `
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background-color: #fff;
    color: #333;
    cursor: pointer;
    margin-left: 10px;
    font-weight: normal;
    transition: all 0.3s ease;
  `;
  
  // Dark theme styles
  const darkStyles = `
    body.dark #viewToggle {
      background-color: #444;
      color: #f0f0f0;
      border-color: #666;
    }
    body.dark #viewToggle.active {
      background-color: #4CAF50;
      color: white;
      font-weight: bold;
    }
  `;
  
  // Add dark theme styles if not already present
  if (!document.querySelector('#viewToggleStyles')) {
    const style = document.createElement('style');
    style.id = 'viewToggleStyles';
    style.textContent = darkStyles;
    document.head.appendChild(style);
  }
  
  toggleButton.addEventListener('click', () => {
    if (continuousViewMode) {
      // Switch to traditional view
      continuousViewMode = false;
      toggleButton.textContent = 'Continuous View';
      toggleButton.title = 'Switch to continuous 40-day view';
      toggleButton.style.backgroundColor = '#fff';
      toggleButton.style.fontWeight = 'normal';
      toggleButton.classList.remove('active');
      
      // Remove continuous view class
      environmentListDiv.classList.remove('continuous-view');
      
      // Remove date range indicator
      const indicator = document.getElementById('dateRangeIndicator');
      if (indicator) {
        indicator.remove();
      }
      
      // Rebuild traditional calendar
      buildCalendar(currentYear, currentMonth);
    } else {
      // Switch to continuous view
      initContinuousView();
      toggleButton.textContent = 'Traditional View';
      toggleButton.title = 'Switch to traditional month view';
      toggleButton.style.backgroundColor = '#4CAF50';
      toggleButton.style.color = 'white';
      toggleButton.style.fontWeight = 'bold';
      toggleButton.classList.add('active');
    }
  });
  
  controls.appendChild(toggleButton);
}

/**
 * Add date range indicator for continuous view
 */
function addDateRangeIndicator() {
  // Remove existing indicator
  const existingIndicator = document.getElementById('dateRangeIndicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  const indicator = document.createElement('div');
  indicator.id = 'dateRangeIndicator';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    z-index: 1000;
    pointer-events: none;
  `;
  
  // Dark theme styles
  const darkStyles = `
    body.dark #dateRangeIndicator {
      background: rgba(255, 255, 255, 0.9);
      color: black;
    }
  `;
  
  if (!document.querySelector('#dateRangeIndicatorStyles')) {
    const style = document.createElement('style');
    style.id = 'dateRangeIndicatorStyles';
    style.textContent = darkStyles;
    document.head.appendChild(style);
  }
  
  updateDateRangeIndicator();
  document.body.appendChild(indicator);
}

/**
 * Update the date range indicator text
 */
function updateDateRangeIndicator() {
  const indicator = document.getElementById('dateRangeIndicator');
  if (!indicator || !continuousViewMode) return;
  
  const endDate = new Date(continuousViewStartDate);
  endDate.setDate(endDate.getDate() + visibleDays - 1);
  
  const startStr = continuousViewStartDate.toLocaleDateString('default', { 
    month: 'short', 
    day: 'numeric' 
  });
  const endStr = endDate.toLocaleDateString('default', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
  
  // Show month name and year for clarity
  const monthYear = continuousViewStartDate.toLocaleDateString('default', { month: 'long', year: 'numeric' });
  indicator.textContent = `${monthYear} (${startStr} - ${endStr})`;
}


function calculatePairConflicts(
  username1: string,
  username2: string,
  year: number
): { date: string; user1Type: string; user2Type: string }[] {
  const user1DaysOff: ReleaseEntry[] = releasesData[username1] || [];
  const user2DaysOff: ReleaseEntry[] = releasesData[username2] || [];

  const conflicts: { date: string; user1Type: string; user2Type: string }[] = [];

  user1DaysOff.forEach(dayOff1 => {
    const date = parseLocalDate(dayOff1.date);
    if (date.getFullYear() === year) {
      const conflictingDayOff = user2DaysOff.find(dayOff2 => dayOff2.date === dayOff1.date);
      if (conflictingDayOff) {
        conflicts.push({
          date: dayOff1.date,
          user1Type: dayOff1.status,
          user2Type: conflictingDayOff.status
        });
      }
    }
  });

  return conflicts;
}

/**
 * Show environment statistics when right-clicking on an environment name
 */
function showEnvironmentStatistics(environment: string, event: MouseEvent) {
  event.preventDefault();
  const env = environmentsData.environments.find((e) => e.name === environment);
  if (!env) {
    console.error("Environment not found:", environment);
    return;
  }

  userStatsName.textContent = env.displayName;

  const currentYearStats = calculateYearlyStats(environment, currentYear);
  let statsHtml = `<h4>${currentYear} Statistics</h4>`;
  statsHtml += '<div class="stats-table">';
  const releaseStatuses = Object.keys(environmentsData.releaseStatuses).sort((a, b) => a.localeCompare(b));
  statsHtml += "<table>";
  statsHtml += "<tr><th>Release Status</th><th>Days</th></tr>";

  let totalDays = 0;
  releaseStatuses.forEach((status) => {
    const count = currentYearStats[status] || 0;
    if (count > 0) {
      statsHtml += `<tr>
      <td>
        <span class="color-dot" style="background-color: ${environmentsData.releaseStatuses[status].background};"></span>
        ${status}
      </td>
      <td>${count}</td>
    </tr>`;
      totalDays += count;
    }
  });

  statsHtml += `<tr class="total-row">
  <td>Total</td>
  <td>${totalDays}</td>
</tr>`;
  statsHtml += "</table>";
  statsHtml += "</div>";

  statsHtml += `<h4>Monthly Distribution</h4>`;
  statsHtml += '<div class="monthly-stats">';
  const monthlyStats = calculateMonthlyStats(environment, currentYear);
  const monthNames = Array.from(
    { length: 12 },
    (_, i) => new Date(0, i).toLocaleString("default", { month: "short" })
  );

  statsHtml += '<div class="month-bars">';
  monthNames.forEach((month, index) => {
    const monthCount = Object.values(monthlyStats[index] || {}).reduce((sum, count) => sum + count, 0);
    const heightPercent = Math.min(100, monthCount * 10);
    const baseColor = '#5aa0ff';
    statsHtml += `<div class="month-column">
    <div class="month-bar-container">
      <div class="month-bar" style="height: ${heightPercent}%; background: ${baseColor}" title="${monthCount} releases in ${month}"></div>
      <div class="month-count">${monthCount || ""}</div>
    </div>
    <div class="month-name">${month}</div>
  </div>`;
  });
  statsHtml += "</div>";
  statsHtml += "</div>";

  userStatsContent.innerHTML = statsHtml;
  userStatsModal.style.display = "flex";
}

/**
 * Close the user stats modal
 */
function closeUserStatsModal() {
  userStatsModal.style.display = 'none';
}

/**
 * Calculate yearly statistics for a user
 */
function calculateYearlyStats(environment: string, year: number): { [type: string]: number } {
  const environmentReleases = releasesData[environment] || [];
  const stats: { [type: string]: number } = {};

  environmentReleases.forEach(release => {
    // Parse the date to check if it's in the selected year
    const releaseDate = parseLocalDate(release.date);
    if (releaseDate.getFullYear() === year) {
      stats[release.status] = (stats[release.status] || 0) + 1;
    }
  });

  return stats;
}

/**
 * Calculate used days per year broken down by carryover vs current-year allowance
 */
function calculateUsedDays(username: string, year: number): { total: number; carryover: number; base: number; nextYearCarryFromThisYear: number } {
  const userDaysOff = releasesData[username] || [];
  let total = 0;
  let carryover = 0; // used in 'year' from last year's allowance
  let base = 0;      // used in 'year' from this year's allowance
  let nextYearCarryFromThisYear = 0; // consumed next year but originating from this year's allowance
  userDaysOff.forEach((entry) => {
    const d = parseLocalDate(entry.date);
    const y = d.getFullYear();
    if (y === year) {
      total += 1;
      base += 1; // All releases count as base usage
    }
  });
  return { total, carryover, base, nextYearCarryFromThisYear };
}

/**
 * Calculate monthly statistics for a user
 */
function calculateMonthlyStats(environment: string, year: number): { [month: number]: { [type: string]: number } } {
  const environmentReleases = releasesData[environment] || [];
  const monthlyStats: { [month: number]: { [type: string]: number } } = {};

  // Initialize all months
  for (let i = 0; i < 12; i++) {
    monthlyStats[i] = {};
  }

  environmentReleases.forEach(release => {
    // Parse the date to check if it's in the selected year
    const releaseDate = parseLocalDate(release.date);
    if (releaseDate.getFullYear() === year) {
      const month = releaseDate.getMonth();
      monthlyStats[month][release.status] = (monthlyStats[month][release.status] || 0) + 1;
    }
  });

  return monthlyStats;
}

/**
 * Set up drag event listeners for a day-off cell
 */
function setupDragEvents(cell, environment, releaseEntry) {
  cell.addEventListener("dragstart", (e) => {
    // Only allow dragging if it's a regular day off (not a holiday)
    if (cell.classList.contains("holiday") || cell.classList.contains("weekend")) {
      e.preventDefault();
      return;
    }

    draggedCell = cell;
    draggedEnvironment = environment;
    draggedReleaseEntry = releaseEntry;

    // Store the index for later removal if the drag succeeds
    const environmentReleases = releasesData[environment] || [];
    draggedIndex = environmentReleases.findIndex(entry => entry.date === releaseEntry.date);

    // Visual feedback during drag
    setTimeout(() => {
      cell.classList.add("dragging");
    }, 0);

    console.log("Drag started:", environment, releaseEntry.date);
  });

  cell.addEventListener("dragend", (e) => {
    cell.classList.remove("dragging");
    console.log("Drag ended");
  });

  // Set correct tooltip content with comprehensive information
  let tooltipParts = [`${environment} - ${releaseEntry.status}`];
  if (releaseEntry.releaseName) tooltipParts.push(`Release: ${releaseEntry.releaseName}`);
  if (releaseEntry.jiraTicket) {
    if (isValidJiraTicket(releaseEntry.jiraTicket)) {
      tooltipParts.push(`Jira: ${releaseEntry.jiraTicket} (click to open)`);
    } else {
      tooltipParts.push(`Jira: ${releaseEntry.jiraTicket}`);
    }
  }
  if (releaseEntry.startTime && releaseEntry.endDateTime) {
    const endDate = releaseEntry.endDateTime.split('T')[0];
    const endTime = releaseEntry.endDateTime.split('T')[1];
    if (endDate !== releaseEntry.date) {
      tooltipParts.push(`Time: ${releaseEntry.startTime} (${releaseEntry.date}) - ${endTime} (${endDate})`);
    } else {
      tooltipParts.push(`Time: ${releaseEntry.startTime}-${endTime}`);
    }
  }
  if (releaseEntry.note) tooltipParts.push(`Note: ${releaseEntry.note}`);
  
  cell.setAttribute('data-tooltip', tooltipParts.join('\n'));

  // Tooltip functionality now handled by Tippy.js in initTippyTooltips()
}


/**
 * Update dependencies that reference a moved release
 */
function updateDependenciesForMovedRelease(movedEnvironment: string, oldDate: string, newDate: string) {
  const oldDependencyRef = `${movedEnvironment}:${oldDate}`;
  const newDependencyRef = `${movedEnvironment}:${newDate}`;
  
  // Search through all environments and releases to find dependencies that reference the moved release
  Object.keys(releasesData).forEach(env => {
    const releases = releasesData[env] || [];
    releases.forEach(release => {
      if (release.dependsOn === oldDependencyRef) {
        // Update the dependency reference to point to the new date
        release.dependsOn = newDependencyRef;
        console.log(`Updated dependency in ${env} from ${oldDependencyRef} to ${newDependencyRef}`);
      }
    });
  });
}

/**
 * Set up drop target for empty cells
 */
function setupDropTarget(cell, environment, isoDate) {
  cell.addEventListener("dragover", (e) => {
    if (!draggedEnvironment ||
      draggedEnvironment !== environment ||
      cell.classList.contains("release") ||
      cell.classList.contains("holiday") ||
      cell.classList.contains("weekend")) {
      return;
    }
    e.preventDefault();
    cell.classList.add("drag-over");
  });

  cell.addEventListener("dragleave", (e) => {
    cell.classList.remove("drag-over");
  });

  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drag-over");

    if (!draggedCell || !draggedEnvironment || !draggedReleaseEntry || draggedIndex === -1) {
      console.log("Invalid drag data");
      return;
    }

    if (draggedEnvironment !== environment) {
      console.log("Cannot drop across different environments");
      return;
    }

    console.log("Dropped on", environment, isoDate);
    const environmentReleases = releasesData[environment] || [];

    if (draggedIndex !== -1) {
      // Get the old date before we remove it from the array
      const oldDate = draggedReleaseEntry.date;

      // Remove the old entry
      environmentReleases.splice(draggedIndex, 1);

      // Create a new entry for the drop target, preserving all fields
      const newEntry: ReleaseEntry = {
        date: isoDate,
        status: draggedReleaseEntry.status
      };
      
      // Copy all optional fields
      if (draggedReleaseEntry.feTag) newEntry.feTag = draggedReleaseEntry.feTag;
      if (draggedReleaseEntry.beTag) newEntry.beTag = draggedReleaseEntry.beTag;
      if (draggedReleaseEntry.releaseName) newEntry.releaseName = draggedReleaseEntry.releaseName;
      if (draggedReleaseEntry.jiraTicket) newEntry.jiraTicket = draggedReleaseEntry.jiraTicket;
      if (draggedReleaseEntry.startTime) newEntry.startTime = draggedReleaseEntry.startTime;
      if (draggedReleaseEntry.endDateTime) newEntry.endDateTime = draggedReleaseEntry.endDateTime;
      if (draggedReleaseEntry.dependsOn) newEntry.dependsOn = draggedReleaseEntry.dependsOn;
      if (draggedReleaseEntry.note) newEntry.note = draggedReleaseEntry.note;
      environmentReleases.push(newEntry);

      // Update the drop target cell
      const statusConfig = environmentsData.releaseStatuses[newEntry.status];
      cell.style.backgroundColor = statusConfig.background;
      cell.style.color = statusConfig.foreground;

      // Set comprehensive tooltip after drag and drop
      let tooltipParts = [`${environment} - ${newEntry.status}`];
      if (newEntry.releaseName) tooltipParts.push(`Release: ${newEntry.releaseName}`);
      if (newEntry.jiraTicket) {
        if (isValidJiraTicket(newEntry.jiraTicket)) {
          tooltipParts.push(`Jira: ${newEntry.jiraTicket} (click to open)`);
        } else {
          tooltipParts.push(`Jira: ${newEntry.jiraTicket}`);
        }
      }
      if (newEntry.startTime && newEntry.endDateTime) {
        const endDate = newEntry.endDateTime.split('T')[0];
        const endTime = newEntry.endDateTime.split('T')[1];
        if (endDate !== newEntry.date) {
          tooltipParts.push(`Time: ${newEntry.startTime} (${newEntry.date}) - ${endTime} (${endDate})`);
        } else {
          tooltipParts.push(`Time: ${newEntry.startTime}-${endTime}`);
        }
      }
      if (newEntry.note) tooltipParts.push(`Note: ${newEntry.note}`);
      cell.setAttribute('data-tooltip', tooltipParts.join('\n'));

      cell.classList.add("release");
      cell.dataset.status = newEntry.status;
      cell.setAttribute("draggable", "true");
      setupDragEvents(cell, environment, newEntry);

      // Completely reset the original cell
      draggedCell.style.backgroundColor = "";
      draggedCell.style.color = "";
      draggedCell.removeAttribute('data-tooltip');
      draggedCell.classList.remove("release");
      draggedCell.removeAttribute("draggable");
      delete draggedCell.dataset.status;

      // Critical fix: Setup the original cell as a drop target again
      setupDropTarget(draggedCell, environment, oldDate);

      // Update any dependencies that reference this moved release
      updateDependenciesForMovedRelease(environment, oldDate, isoDate);

      saveData(environment);
      
      // Rebuild calendar to update dependency rows and tooltips
      buildCalendar(currentYear, currentMonth);
      
      console.log("Release moved successfully");
    }

    draggedCell = null;
    draggedEnvironment = null;
    draggedReleaseEntry = null;
    draggedIndex = -1;
  });
}

/**
 * Add a release with "staging" environment and "planned" status on double-click
 */
function addQuickRelease(environment, isoDate, cell) {
  if (cell.classList.contains("weekend") ||
    cell.classList.contains("holiday") ||
    cell.classList.contains("release")) {
    return;
  }

  if (!releasesData[environment]) {
    releasesData[environment] = [];
  }

  const releaseEntry = {
    date: isoDate,
    status: "Planned"
  };

  releasesData[environment].push(releaseEntry);

  const statusConfig = environmentsData.releaseStatuses["Planned"];
  cell.style.backgroundColor = statusConfig.background;
  cell.style.color = statusConfig.foreground;
  cell.classList.add("release");
  cell.dataset.status = "Planned";
  cell.setAttribute("draggable", "true");
  setupDragEvents(cell, environment, releaseEntry);

  // Set tooltip for quick added release
  cell.setAttribute('data-tooltip', `${environment} - Planned`);

  console.log("Quick release added for", environment, "on", isoDate);
  saveData(environment);
}

/**
 * Set up mobile action handlers
 */
function setupMobileActions() {
  // Check if mobile elements exist
  const mobileFab = document.getElementById('mobileFab') as HTMLDivElement;
  const mobileActions = document.getElementById('mobileActions') as HTMLDivElement;
  const mobileShowToday = document.getElementById('mobileShowToday') as HTMLDivElement;
  const mobileToggleTheme = document.getElementById('mobileToggleTheme') as HTMLDivElement;
  const mobileExportData = document.getElementById('mobileExportData') as HTMLDivElement;

  if (!mobileFab || !mobileActions) {
    console.error("Mobile action elements not found");
    return;
  }

  // Toggle mobile actions panel visibility
  mobileFab.addEventListener('click', () => {
    mobileActions.classList.add('visible');
  });

  // Close mobile actions when clicking the close handle
  const mobileActionClose = document.querySelector('.mobile-action-close') as HTMLElement;
  if (mobileActionClose) {
    mobileActionClose.addEventListener('click', () => {
      mobileActions.classList.remove('visible');
    });
  }

  // Close mobile actions when clicking outside
  document.addEventListener('click', (e) => {
    if (mobileActions.classList.contains('visible') &&
      !mobileActions.contains(e.target as Node) &&
      e.target !== mobileFab) {
      mobileActions.classList.remove('visible');
    }
  });

  // Mobile action button handlers
  if (mobileShowToday) {
    mobileShowToday.addEventListener('click', () => {
      const today = new Date();
      currentMonth = today.getMonth();
      currentYear = today.getFullYear();

      // Update the dropdowns
      monthSelect.value = currentMonth.toString();
      yearSelect.value = currentYear.toString();

      // Rebuild the calendar
      buildCalendar(currentYear, currentMonth);

      // Hide mobile actions
      mobileActions.classList.remove('visible');

      showNotification("Calendar set to current month", "info");
    });
  }

  if (mobileToggleTheme) {
    mobileToggleTheme.addEventListener('click', () => {
      if (document.body.classList.contains("dark")) {
        document.body.classList.remove("dark");
        document.body.classList.add("light");
      } else {
        document.body.classList.remove("light");
        document.body.classList.add("dark");
      }
      updateThemeToggleText();

      // Hide mobile actions
      mobileActions.classList.remove('visible');
    });
  }

  if (mobileExportData) {
    mobileExportData.addEventListener('click', () => {
      exportCalendarData();

      // Hide mobile actions
      mobileActions.classList.remove('visible');
    });
  }
}

/**
 * Populate the dependsOn select with available releases
 */
function populateDependsOnSelect(currentEnvironment: string, currentDate: string) {
  dependsOnSelect.innerHTML = '<option value="">No dependency</option>';
  
  // Get all releases from all environments
  Object.keys(releasesData).forEach(env => {
    const releases = releasesData[env] || [];
    releases.forEach(release => {
      // Don't allow self-dependency
      if (env === currentEnvironment && release.date === currentDate) {
        return;
      }
      
      const option = document.createElement('option');
      const value = `${env}:${release.date}`;
      let displayName = `${env} - ${release.date}`;
      if (release.releaseName) {
        displayName += ` (${release.releaseName})`;
      }
      option.value = value;
      option.textContent = displayName;
      dependsOnSelect.appendChild(option);
    });
  });
}

/**
 * Open the modal for adding or editing an entry.
 */
function openModal(environment, isoDate, cell) {
  modalContext = { environment, isoDate, cell };
  const date = parseLocalDate(isoDate);
  const isWeekendDay = date.getDay() === 0 || date.getDay() === 6;

  const holiday = getHoliday(isoDate);
  if (holiday) {
    holidayInfo.style.display = "block";
    holidayInfo.textContent = `Holiday: ${holiday.name}`;
    editableArea.style.display = "none";
    saveButton.style.display = "none";
    removeButton.style.display = "none";
  } else if (isWeekendDay) {
    // Don't show weekend as an option
    holidayInfo.style.display = "block";
    holidayInfo.textContent = "Weekend: Release planning not available";
    editableArea.style.display = "none";
    saveButton.style.display = "none";
    removeButton.style.display = "none";
  } else {
    holidayInfo.style.display = "none";
    editableArea.style.display = "block";
    saveButton.style.display = "inline-block";

    // Populate status select
    releaseStatusSelect.innerHTML = "";
    Object.keys(environmentsData.releaseStatuses).forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.text = status;
      releaseStatusSelect.appendChild(option);
    });

    // Populate dependsOn select
    populateDependsOnSelect(environment, isoDate);

    const environmentReleases = releasesData[environment] || [];
    const existingEntry = environmentReleases.find((entry) => entry.date === isoDate);
    if (existingEntry) {
      // Populate all fields with existing values
      releaseStatusSelect.value = existingEntry.status;
      feTagInput.value = existingEntry.feTag || "";
      beTagInput.value = existingEntry.beTag || "";
      releaseNameInput.value = existingEntry.releaseName || "";
      jiraTicketInput.value = existingEntry.jiraTicket || "";
      startTimeInput.value = existingEntry.startTime || "20:00";
      endDateTimeInput.value = existingEntry.endDateTime || "";
      dependsOnSelect.value = existingEntry.dependsOn || "";
      removeButton.style.display = "inline-block";
      console.log("Remove button should be visible for existing entry");
      
      // Update Jira link for existing entry
      updateJiraLink();
    } else {
      // Clear all fields for new entry
      releaseStatusSelect.value = "Planned";
      feTagInput.value = "";
      beTagInput.value = "";
      releaseNameInput.value = "";
      jiraTicketInput.value = "";
      startTimeInput.value = "20:00";
      endDateTimeInput.value = "";
      dependsOnSelect.value = "";
      removeButton.style.display = "none";
      
      // Hide Jira link and tickets list for new entry
      jiraLink.style.display = "none";
      jiraTicketsList.style.display = "none";
    }
    
    // Update flatpickr instance to reflect the current field value
    if ((window as any).endDateTimeFlatpickr && endDateTimeInput.value) {
      (window as any).endDateTimeFlatpickr.setDate(endDateTimeInput.value);
    }
  }
  cancelButton.style.display = "inline-block";
  modal.style.display = "flex";
  console.log("Modal opened for environment:", environment, "date:", isoDate);
}

// No paired employees for environments

// Check if a date has a release for a specific environment
function hasEnvironmentRelease(environment, isoDate) {
  if (!environment || !releasesData[environment]) return false;
  return releasesData[environment].some(entry => entry.date === isoDate);
}

// Helper function to check if the date is a weekend
function isWeekend(isoDate) {
  const date = parseLocalDate(isoDate);
  return date.getDay() === 0 || date.getDay() === 6;
}

// Initialize Tippy.js tooltip system
function initTippyTooltips() {
  // Destroy existing tooltips first
  document.querySelectorAll('[data-tippy-content]').forEach(el => {
    if ((el as any)._tippy) {
      (el as any)._tippy.destroy();
    }
  });

  // Initialize tooltips for all elements with data-tooltip
  const tooltipElements = document.querySelectorAll('[data-tooltip]');
  tooltipElements.forEach(element => {
    const tooltipContent = element.getAttribute('data-tooltip');
    if (tooltipContent) {
      // Create HTML content for better formatting
      const htmlContent = tooltipContent.split('\n').map(line => {
        if (line.includes(':')) {
          const [label, value] = line.split(': ', 2);
          return `<div class="tooltip-field"><strong>${label}:</strong> ${value}</div>`;
        }
        return `<div class="tooltip-field">${line}</div>`;
      }).join('');

      tippy(element as HTMLElement, {
        content: htmlContent,
        allowHTML: true,
        theme: 'dark', // Always use dark theme for tooltips
        placement: 'top',
        arrow: true,
        animation: 'fade',
        duration: [200, 150],
        delay: [500, 0],
        interactive: false,
        maxWidth: 300,
        zIndex: 1000
      });
    }
  });
}

function initTooltipSystem() {
  // Use Tippy.js instead of custom tooltips
  initTippyTooltips();
}

function showAllowanceDialog(username: string, year: number) {
  let dlg = document.getElementById("allowanceDialog") as HTMLDivElement | null;
  if (!dlg) {
    dlg = document.createElement("div");
    dlg.id = "allowanceDialog";
    dlg.className = "modal";
    dlg.innerHTML = `
      <div class="modal-content">
        <h3>Set Allowance for <span id="allowanceYear"></span></h3>
        <div class="form-group">
          <label for="allowanceInput">Allowance (days):</label>
          <input type="number" id="allowanceInput" min="0" step="1" />
        </div>
        <div class="modal-buttons">
          <button id="allowanceCancel">Cancel</button>
          <button id="allowanceClear">Clear</button>
          <button id="allowanceSet">Set</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    // Close when clicking outside
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) {
        dlg!.style.display = "none";
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dlg && dlg.style.display === "flex") {
        dlg.style.display = "none";
      }
    });
  }

  const yearSpan = document.getElementById("allowanceYear") as HTMLSpanElement | null;
  const input = document.getElementById("allowanceInput") as HTMLInputElement | null;
  const btnCancel = document.getElementById("allowanceCancel");
  const btnClear = document.getElementById("allowanceClear");
  const btnSet = document.getElementById("allowanceSet");

  if (yearSpan) yearSpan.textContent = String(year);

  // Allowances not applicable to environments
  if (input) input.value = "";

  if (btnCancel) btnCancel.onclick = () => { if (dlg) dlg.style.display = "none"; };
  if (btnClear) btnClear.onclick = async () => {
    // Allowances not applicable to environments
    if (dlg) dlg.style.display = "none";
  };
  if (btnSet) btnSet.onclick = async () => {
    const raw = input ? input.value.trim() : "";
    const val = Math.max(0, Math.floor(Number(raw) || 0));
    // Allowances not applicable to environments
    if (dlg) dlg.style.display = "none";
  };

  if (dlg) dlg.style.display = "flex";
}

/**
 * Apply dynamic cell sizing to optimize space usage
 */
function applyDynamicCellSizing() {
  if (!environmentListDiv) return;
  
  // Get all day cells
  const dayCells = environmentListDiv.querySelectorAll('.day-cell:not(.continuous-day)');
  const continuousDayCells = environmentListDiv.querySelectorAll('.continuous-day');
  const dependencyCells = environmentListDiv.querySelectorAll('.dependency-cell');
  
  // Calculate optimal width for traditional view
  if (dayCells.length > 0) {
    const containerWidth = environmentListDiv.offsetWidth;
    const environmentNameWidth = 110; // Calculated width for environment names
    const availableWidth = containerWidth - environmentNameWidth;
    const cellCount = dayCells.length / (environmentListDiv.querySelectorAll('.row').length - 1); // Subtract header row
    const optimalWidth = Math.max(32, Math.floor(availableWidth / cellCount));
    
    // Apply width to all day cells
    dayCells.forEach(cell => {
      (cell as HTMLElement).style.width = `${optimalWidth}px`;
      (cell as HTMLElement).style.minWidth = '32px';
    });
  }
  
  // Calculate optimal width for continuous view
  if (continuousDayCells.length > 0) {
    const containerWidth = environmentListDiv.offsetWidth;
    const environmentNameWidth = 110; // Calculated width for environment names
    const availableWidth = containerWidth - environmentNameWidth;
    const cellCount = visibleDays; // This is now the actual number of days in the month
    const optimalWidth = Math.max(32, Math.floor(availableWidth / cellCount));
    
    // Apply width to all continuous day cells
    continuousDayCells.forEach(cell => {
      (cell as HTMLElement).style.width = `${optimalWidth}px`;
      (cell as HTMLElement).style.minWidth = '32px';
    });
    
    // Apply the same width to dependency cells to ensure alignment
    dependencyCells.forEach(cell => {
      (cell as HTMLElement).style.width = `${optimalWidth}px`;
      (cell as HTMLElement).style.minWidth = '32px';
    });
  }
}
