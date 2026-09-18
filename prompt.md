Create a complete **Mind Map web application as a single HTML page**.

## Technology

* Use **HTML5**.
* Use **Bootstrap 5** for all application UI and layout.
* Use **plain JavaScript** for all application logic.
* Use **Cytoscape.js** as the JavaScript graph/mind-map visualization library.
* Do NOT use React, Vue, Angular, jQuery, TypeScript, or any other application framework.
* Cytoscape.js is explicitly allowed and should be used for rendering and interacting with the mind map.
* Do NOT implement the graph renderer manually with Canvas.
* Do NOT use D3.js.
* Do NOT create custom CSS classes.
* Do NOT create a separate CSS file.
* Use Bootstrap 5 built-in classes/utilities wherever possible.
* JavaScript must be contained in the same HTML file.
* The application must work as a standalone local HTML page.
* Load Bootstrap 5 and Cytoscape.js from CDNs.
* No backend/server is required.

The resulting application must consist of **one complete `.html` file**.

## Mind-map model

The application represents a mind map as a **graph**.

A mind map contains:

* Nodes/points.
* Relationships/connections between nodes.

A node may be connected to any number of other nodes.

Do NOT assume that the structure is necessarily a tree.

The graph must therefore support:

* one node connected to many nodes
* multiple connections between different branches
* arbitrary graph relationships
* a root node, if one is defined
* nodes without parents
* nodes with multiple relationships

Cytoscape.js should be responsible for graph rendering, positioning, zooming, panning, node selection, and edge interaction.

## JSON data storage

The complete mind map must be stored in a JSON file.

Provide:

* **New Map**
* **Open JSON**
* **Save JSON**

Do NOT use localStorage as the primary data store.

Use a simple human-readable JSON format.

Example:

```json
{
  "version": 1,
  "title": "My Mind Map",
  "rootId": "node-1",
  "nodes": [
    {
      "id": "node-1",
      "title": "Central Topic",
      "description": "Main topic",
      "x": 500,
      "y": 300,
      "images": [],
      "audio": [],
      "video": [],
      "files": []
    },
    {
      "id": "node-2",
      "title": "Related Topic",
      "description": "Another topic",
      "x": 750,
      "y": 200,
      "images": [],
      "audio": [],
      "video": [],
      "files": []
    }
  ],
  "connections": [
    {
      "source": "node-1",
      "target": "node-2"
    }
  ]
}
```

The implementation may extend this structure when necessary, but keep it simple and transparent.

## Cytoscape.js

Use Cytoscape.js as the graph engine.

Do NOT draw nodes and connections manually.

Cytoscape.js must handle:

* rendering
* node positioning
* edges
* selection
* dragging
* zoom
* pan
* fitting the graph to the available area
* viewport centering
* edge selection
* node selection

Use an appropriate Cytoscape.js layout for an initial automatic arrangement.

The application should support switching or configuring layouts if useful.

At minimum provide:

* a reasonable automatic layout
* manually draggable nodes
* Fit Map

When a JSON file contains `x` and `y` coordinates, restore those positions instead of automatically rearranging the nodes.

After the user manually moves a node, its position must be stored in the application state and saved to JSON.

## Main UI

Create a Bootstrap 5 interface.

### Top toolbar

Provide buttons for:

* New Map
* Open JSON
* Save JSON
* Add Node
* Edit Node
* Delete Node
* Connect Nodes
* Delete Connection
* Fit Map
* Zoom In
* Zoom Out
* Automatic Layout

Display the current map title.

Use Bootstrap button groups where appropriate.

Also provide a search field.

## Main layout

Use a responsive Bootstrap grid.

On large screens:

* Main graph area: approximately 8–9 columns.
* Sidebar: approximately 3–4 columns.

On small screens:

* Graph area appears first.
* Sidebar moves below the graph.

The graph area should fill the available viewport height as much as practical.

Do not create custom CSS classes to accomplish this.

Use Bootstrap layout and utility classes.

## Graph area

The graph area contains the Cytoscape.js visualization.

Nodes should be visually represented as readable boxes.

Each node should display:

* title
* optionally a short description
* attachment indicators

Possible indicators:

* image count
* audio count
* video count
* file count

Use Cytoscape node labels and styling configuration.

Do not create HTML/CSS node elements unless Cytoscape.js specifically requires them.

## Node selection

Clicking a node selects it.

The selected node must be visually highlighted.

When a node is selected:

* update the sidebar
* display its information
* display its attachments
* display its connections

Clicking empty graph space should deselect the node.

The selected node must remain synchronized between the Cytoscape graph and application state.

## Node editing

Provide an **Edit Node** Bootstrap modal.

Fields:

* Title
* Description

Buttons:

* Save
* Cancel

When saved:

1. Update the JSON data model.
2. Update the Cytoscape node.
3. Update the sidebar.
4. Mark the map as dirty.

Do not reload the entire graph unnecessarily.

## Add Node

When the user clicks **Add Node**:

1. Generate a unique node ID.
2. Create a new node.
3. Open the node-edit modal.
4. Allow the user to enter title and description.
5. Add the node to the JSON model.
6. Add the node to Cytoscape.
7. Select the new node.
8. Allow the node to be dragged.

If another node is currently selected, offer:

**Connect new node to selected node**

If enabled, automatically create the relationship after creating the node.

## Delete Node

When Delete Node is selected:

* Require a selected node.
* Display a Bootstrap confirmation modal.
* Explain that all connections to the node will also be removed.

After confirmation:

* remove the node from the JSON model
* remove all related connections
* remove the node from Cytoscape
* update the sidebar
* clear selection
* mark the map dirty

## Connections

Connections represent relationships between nodes.

Use Cytoscape.js edges.

Provide a **Connect Nodes** mode.

Workflow:

1. Click Connect Nodes.
2. Select the first node.
3. Select the second node.
4. Create an edge.

Show a clear indication that connection mode is active.

Prevent duplicate connections.

Do not allow a node to connect to itself unless explicitly supported by the data model.

Store only node IDs in the JSON:

```json
{
  "source": "node-1",
  "target": "node-4"
}
```

Do not duplicate node information inside connections.

## Connection selection

Edges must be selectable.

When an edge is selected:

* visually highlight it
* show its source and target nodes in the sidebar or status area
* enable **Delete Connection**

Delete Connection should remove the edge from both:

* Cytoscape
* JSON data model

Mark the map dirty.

## Graph interaction

Use Cytoscape.js interaction capabilities.

Support:

* node selection
* edge selection
* node dragging
* pan
* zoom
* mouse wheel zoom
* Fit Map
* center selected node
* automatic layout

Buttons:

**Zoom In**

Increase Cytoscape zoom.

**Zoom Out**

Decrease Cytoscape zoom.

**Fit Map**

Fit all graph elements into the visible graph area.

**Automatic Layout**

Run a Cytoscape layout algorithm.

Do not overwrite saved node coordinates merely by opening a file.

If the user explicitly chooses Automatic Layout, update node positions and mark the map dirty.

## Layout

Use a Cytoscape.js layout suitable for a mind-map-like graph.

Prefer a hierarchical or force-directed layout depending on the graph structure.

The application should handle both:

* tree-like mind maps
* arbitrary connected graphs

When opening a JSON file:

* use stored coordinates if available
* otherwise generate an initial layout

After automatic layout:

* save the resulting coordinates to the node data

Example:

```json
{
  "id": "node-2",
  "title": "Topic",
  "x": 820,
  "y": 340
}
```

Coordinates are logical graph coordinates, not browser screen coordinates.

## Node sidebar

Use Bootstrap cards, accordions, list groups, badges, buttons, and forms.

When no node is selected:

Display a Bootstrap empty-state message such as:

"Select a node to view its details."

When a node is selected display:

### Node information

* Title
* Description
* Node ID

### Attachments

Separate sections for:

* Images
* Audio
* Video
* General Files

### Connections

Display connected nodes in a Bootstrap `list-group`.

Clicking a connected node should:

1. Select it in Cytoscape.
2. Center the graph on it.
3. Zoom appropriately.
4. Update the sidebar.

## Attachments

Every node has four attachment arrays:

```text
images
audio
video
files
```

Allow multiple files in every category.

Use:

```html
<input type="file" multiple>
```

with appropriate `accept` attributes for image/audio/video inputs.

Each attachment should contain metadata such as:

```json
{
  "name": "photo.jpg",
  "type": "image/jpeg",
  "size": 123456
}
```

Where practical, allow embedding the actual file as a Data URL/Base64.

Clearly distinguish between:

* metadata-only attachment
* embedded attachment

Do not silently embed very large files.

Before embedding a large file, show a Bootstrap warning/confirmation.

The user must be able to:

* add attachments
* remove attachments
* view/open attachments where possible

Images:

* show thumbnails

Audio:

* provide an HTML `<audio controls>` player

Video:

* provide an HTML `<video controls>` player

General files:

* show filename
* show size
* provide an open/download action when possible

## Important attachment limitation

A JSON file cannot reference arbitrary local filesystem paths in a portable way.

Do not assume that a saved path such as:

```text
C:\Pictures\photo.jpg
```

will work on another computer or after reopening the JSON.

Therefore support embedded attachments using Data URLs/Base64 when the user chooses to embed them.

For metadata-only attachments, clearly indicate that the original file itself is not contained in the JSON.

## JSON import

The Open JSON operation must:

1. Open a file picker.
2. Read the JSON file.
3. Parse JSON.
4. Validate the structure.
5. Normalize optional fields.
6. Validate node IDs.
7. Validate connections.
8. Remove or report invalid connections.
9. Restore node coordinates.
10. Rebuild the Cytoscape graph.
11. Restore the root node.
12. Select the root node if available.
13. Fit the graph.

Handle malformed JSON gracefully.

Never allow malformed JSON to crash the application.

Use Bootstrap alerts for errors.

## JSON validation

Validate:

* JSON syntax
* version
* title
* nodes array
* unique node IDs
* connections array
* connection source IDs
* connection target IDs

If optional fields are missing:

```text
images
audio
video
files
```

create empty arrays.

If a node has no ID, generate one.

If duplicate IDs exist, report the problem and resolve them safely.

If a connection references a nonexistent node, reject that connection and report the issue.

## JSON export

Save the complete current map.

Before exporting:

* synchronize all Cytoscape node positions with the JSON model
* synchronize all connections
* include attachment metadata/data
* include rootId
* include map title

Use:

```javascript
JSON.stringify(data, null, 2)
```

Create a downloadable `.json` file using `Blob`.

Use the map title to generate a sensible filename.

Example:

```text
My-Mind-Map.json
```

## Search

Provide a Bootstrap search input.

Search:

* node title
* node description

As the user types, show matching nodes.

Search results should be displayed using Bootstrap list-group items.

Clicking a search result should:

* select the corresponding Cytoscape node
* center it
* optionally zoom to it
* update the sidebar

The matching node should be visually highlighted.

## Map title

Provide a way to edit the map title.

The title should be stored in JSON:

```json
"title": "My Mind Map"
```

Display the title in the toolbar/header.

Changing the title marks the map dirty.

## Dirty state

Track whether the current map has unsaved changes.

Set dirty state when:

* node added
* node deleted
* node edited
* node moved
* connection added
* connection deleted
* attachment added
* attachment removed
* map title changed
* automatic layout executed

Reset dirty state after:

* New Map
* Open JSON
* successful Save JSON

If New Map is requested while there are unsaved changes:

* display a Bootstrap confirmation modal
* allow the user to cancel

## Keyboard shortcuts

Implement:

* `Delete` — delete selected node or edge
* `Escape` — cancel current mode
* `Ctrl+S` — save JSON
* `Ctrl+O` — open JSON
* `Ctrl+N` — new map
* `+` — zoom in
* `-` — zoom out
* `F` — fit graph

Do not trigger browser defaults where they conflict with the application.

Do not trigger shortcuts while the user is typing inside a form field unless appropriate.

## Bootstrap modals

Use Bootstrap 5 modals for:

* Edit Node
* Add Node
* Delete Node confirmation
* New Map confirmation
* Connection workflow if useful
* Large attachment warning
* Error messages where appropriate

Do not implement custom modal windows.

## No custom CSS

This requirement is important.

Do NOT create:

```html
<style>
...
</style>
```

unless absolutely unavoidable for Cytoscape itself.

Do NOT create custom CSS classes such as:

```text
.node
.map
.sidebar
.toolbar
.graph
.selected-node
```

Use Bootstrap 5 classes and Cytoscape's own style configuration.
