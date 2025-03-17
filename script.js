// Global variables
let items = [];
let receipts = [];
let isEditMode = false;
let taxRate = 8; // Default tax rate for Japan (8%)

// Azure OpenAI Vision settings
let AZURE_OPENAI_API_KEY = ""; // Will be loaded from localStorage
let AZURE_OPENAI_ENDPOINT = ""; // Will be loaded from localStorage
let AZURE_OPENAI_MODEL = "gpt-4o"; // Default model - can be changed if needed
const AZURE_API_VERSION = "2024-02-15-preview"; // API Version

// DOM elements
document.addEventListener('DOMContentLoaded', function() {
    // Button event listeners
    document.getElementById('process-photo').addEventListener('click', processReceiptImage);
    document.getElementById('clear-items').addEventListener('click', clearItems);
    document.getElementById('save-receipt').addEventListener('click', saveReceipt);
    document.getElementById('add-missing-item').addEventListener('click', showAddItemForm);
    document.getElementById('save-item').addEventListener('click', addItem);
    document.getElementById('cancel-add').addEventListener('click', hideAddItemForm);
    document.getElementById('edit-mode').addEventListener('click', toggleEditMode);
    document.getElementById('apply-tax').addEventListener('click', applyTaxRate);
    document.getElementById('save-api-settings') && document.getElementById('save-api-settings').addEventListener('click', saveApiSettings);
    
    // Initialize tax rate from input
    document.getElementById('tax-rate').value = taxRate;
    document.getElementById('tax-info').textContent = `${taxRate}% tax is applied automatically to the total`;
    
    // Initialize currency selector if it exists
    if (document.getElementById('currency-symbol')) {
        document.getElementById('currency-symbol').addEventListener('change', function() {
            renderItems();
            updateTotals();
        });
    }
    
    // Load Azure API settings if they exist
    loadApiSettings();
    
    // Photo upload and camera handling - simpler approach
    const photoInput = document.getElementById('receipt-photo');
    const uploadButton = document.getElementById('upload-button');
    const cameraButton = document.getElementById('camera-button');
    
    // Handle file selection changes
    if (photoInput) {
        photoInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files[0]) {
                handleSelectedImage(e.target.files[0]);
                // Reset the input value to allow selecting the same file again
                // (useful for repeated testing)
                this.value = '';
            }
        });
    }
    
    // Handle upload button click
    if (uploadButton) {
        uploadButton.addEventListener('click', function(e) {
            e.preventDefault();
            if (photoInput) {
                photoInput.removeAttribute('capture'); // Remove capture attribute
                photoInput.click();
            }
        });
    }
    
    // Handle camera button click
    if (cameraButton) {
        cameraButton.addEventListener('click', function(e) {
            e.preventDefault();
            if (photoInput) {
                photoInput.setAttribute('capture', 'camera'); // Add capture attribute
                photoInput.click();
            }
        });
    }
    
    // Load saved receipts from local storage
    loadSavedReceipts();
});

// Process the selected image - more compatible version
function handleSelectedImage(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const previewDiv = document.getElementById('photo-preview');
        if (previewDiv) {
            previewDiv.innerHTML = `<img src="${e.target.result}" alt="Receipt preview">`;
            const processButton = document.getElementById('process-photo');
            if (processButton) {
                processButton.disabled = false;
            }
        }
        
        // Store the file reference globally for later processing
        window.selectedReceiptFile = file;
        
        // Ensure the photoInput element has the file
        const photoInput = document.getElementById('receipt-photo');
        if (photoInput && (!photoInput.files || photoInput.files.length === 0)) {
            // Create a new DataTransfer object
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            // Set the files property
            photoInput.files = dataTransfer.files;
        }
    };
    
    reader.onerror = function(error) {
        console.error('Error reading file:', error);
        alert('Error reading the selected image. Please try again.');
    };
    
    reader.readAsDataURL(file);
}
// Function to apply the tax rate
function applyTaxRate() {
    const newTaxRate = parseFloat(document.getElementById('tax-rate').value);
    
    if (isNaN(newTaxRate) || newTaxRate < 0) {
        showSnackbar('Please enter a valid tax rate');
        return;
    }
    
    taxRate = newTaxRate;
    document.getElementById('tax-info').textContent = `${taxRate}% tax is applied automatically to the total`;
    
    // Update totals with new tax rate
    updateTotals();
    showSnackbar(`Tax rate updated to ${taxRate}%`);
}

// Function to process the receipt image using Azure OpenAI Vision
async function processReceiptImage() {
    const photoInput = document.getElementById('receipt-photo');
    
    // First check if there's a file in the input element
    if ((!photoInput.files || !photoInput.files[0]) && !window.selectedReceiptFile) {
        showSnackbar('Please upload a receipt image first');
        return;
    }
    
    // Use either the file from input or the one stored in window
    const fileToProcess = photoInput.files && photoInput.files[0] ? photoInput.files[0] : window.selectedReceiptFile;
    
    if (!fileToProcess) {
        showSnackbar('Unable to access the receipt image. Please try uploading again.');
        return;
    }
    
    // Check if Azure API settings are configured
    if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
        showSnackbar('Please configure your Azure OpenAI API settings first');
        document.querySelector('.api-settings details').setAttribute('open', '');
        return;
    }
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    loadingIndicator.classList.remove('hidden');
    
    // Progress display
    const progressElement = document.getElementById('progress');
    progressElement.style.width = '30%'; // Initial progress
    
    try {
        // Get language selection
        const language = document.getElementById('ocr-language') ? 
            document.getElementById('ocr-language').value : 'en';
        
        // Get currency symbol
        const currencySymbol = document.getElementById('currency-symbol') ? 
            document.getElementById('currency-symbol').value : '¥';
            
        // Convert the image to base64
        const base64Image = await getBase64(fileToProcess);
        
        // Update progress
        progressElement.style.width = '50%';
        
        // Rest of the function remains the same...
        // Call Azure OpenAI Vision API
        const result = await callAzureOpenAIVision(base64Image, language, currencySymbol);
        
        // Update progress
        progressElement.style.width = '90%';
        
        // Process the extracted items
        if (result.items && result.items.length > 0) {
            // Clear existing items
            items = [];
            
            // Add the extracted items
            result.items.forEach(item => {
                items.push({
                    id: Date.now() + Math.random(), // Unique ID
                    name: item.name,
                    price: item.price,
                    isDiscount: item.price < 0 || (item.name && item.name.toLowerCase().includes('discount')),
                    isMine: false,
                    isFriend: false,
                    isShared: false
                });
            });
            
            // Update the display
            renderItems();
            updateTotals();
            
            // Show notification
            const regularItems = result.items.filter(item => 
                !(item.price < 0 || (item.name && item.name.toLowerCase().includes('discount'))));
            const discountItems = result.items.filter(item => 
                item.price < 0 || (item.name && item.name.toLowerCase().includes('discount')));
                
            showSnackbar(`Detected ${regularItems.length} items and ${discountItems.length} discounts. Please check and assign them.`);
        } else {
            showSnackbar('No items could be detected. Try uploading a clearer image or add items manually');
        }
        
        // Show full extracted text in debug area if it exists
        if (document.getElementById('ocr-debug-output') && result.fullText) {
            document.getElementById('ocr-debug-output').textContent = result.fullText;
            document.getElementById('ocr-debug').classList.remove('hidden');
        }
        
        // Complete progress
        progressElement.style.width = '100%';
        
    } catch (error) {
        console.error('Vision API Error:', error);
        showSnackbar('Error processing the receipt. Please check your Azure API settings or try again with a clearer image');
    } finally {
        // Hide loading indicator after a short delay
        setTimeout(() => {
            loadingIndicator.classList.add('hidden');
            progressElement.style.width = '0%';
        }, 500);
    }
}

// Helper function to convert file to base64
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            // Get the complete base64 string with data URL prefix
            resolve(reader.result);
        };
        reader.onerror = error => reject(error);
    });
}

// Function to call Azure OpenAI Vision API
async function callAzureOpenAIVision(base64Image, language, currencySymbol) {
    // Create a specific prompt for receipt analysis based on language and currency
    let prompt = `This is a receipt image. Please analyze it and extract all items with their prices. `;
    
    if (language === 'ja') {
        prompt += `This is a Japanese receipt. `;
    } else if (language === 'en+ja') {
        prompt += `This receipt may contain both English and Japanese text. `;
    }
    
    prompt += `The currency is ${currencySymbol}. `;
    prompt += `Return a JSON object with:
    1. "items": an array of objects, each with "name" (string) and "price" (number) properties
    2. "fullText": the full extracted text
    
    IMPORTANT: Please identify and include any discounts as separate items with negative prices.
    For percentage discounts, include the percentage in the item name (e.g., "Discount (20%)").
    Look for discount lines with words like "値引", "discount", "off", etc.
    
    Only include actual purchasable items in the "items" array, not subtotals, totals, or tax lines.
    Format all prices as numbers without the currency symbol.
    For Japanese receipts, be careful about signs and symbols that might look similar but have different meanings.
    
    Maintain the same order of items as they appear on the receipt.`;
    
    try {
        // Prepare the request payload - using the structure matching Azure OpenAI client
        const payload = {
            messages: [
                { role: "system", content: "You are a helpful assistant specialized in analyzing receipts." },
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: base64Image } }
                    ]
                }
            ],
            max_tokens: 2000
        };
        
        // Send request to Azure OpenAI API
        const response = await fetch(`${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_MODEL}/chat/completions?api-version=${AZURE_API_VERSION}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': AZURE_OPENAI_API_KEY
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
        }
        
        const responseData = await response.json();
        
        // Extract the assistant's response
        if (responseData.choices && responseData.choices.length > 0) {
            const content = responseData.choices[0].message.content;
            
            // Parse JSON from the response
            try {
                // Look for JSON object in the response
                const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                                 content.match(/```([\s\S]*?)```/) ||
                                 content.match(/\{[\s\S]*?\}/);
                
                if (jsonMatch) {
                    // Extract the JSON part and parse it
                    const jsonStr = jsonMatch[1] || jsonMatch[0];
                    const parsedData = JSON.parse(jsonStr);
                    
                    // Check if the AI already extracted discounts
                    // If not, look for discount information in the full text
                    const hasDiscounts = parsedData.items && parsedData.items.some(item => 
                        (item.price < 0) || 
                        (item.name && item.name.toLowerCase().includes('discount')));
                        
                    if (!hasDiscounts && parsedData.fullText) {
                        const fullText = parsedData.fullText;
                        const discountLines = fullText.split('\n')
                            .filter(line => 
                                line.includes('値引') || 
                                line.includes('discount') || 
                                line.toLowerCase().includes('off') ||
                                (line.includes('-') && /\d+/.test(line)))
                            .map(line => {
                                // Extract discount amount and percentage if available
                                const amountMatch = line.match(/¥(\d+)/) || 
                                                   line.match(/(\d+)円/) || 
                                                   line.match(/-\s*(\d+)/) || 
                                                   null;
                                const percentMatch = line.match(/(\d+)%/) || null;
                                
                                return {
                                    line: line,
                                    amount: amountMatch ? parseInt(amountMatch[1]) : null,
                                    percentage: percentMatch ? parseInt(percentMatch[1]) : null,
                                    isPercentage: percentMatch !== null
                                };
                            });
                        
                        // If we found discounts, add them to the items array
                        if (discountLines.length > 0) {
                            // First, ensure we have an items array
                            const items = parsedData.items || [];
                            
                            // Then add discount items
                            discountLines.forEach(discount => {
                                if (discount.amount) {
                                    items.push({
                                        name: discount.isPercentage ? 
                                            `Discount (${discount.percentage}%)` : 
                                            "Discount",
                                        price: -discount.amount,
                                        isDiscount: true
                                    });
                                }
                            });
                            
                            // Update the parsed data
                            parsedData.items = items;
                        }
                    }
                    
                    return parsedData;
                } else {
                    // Try to parse the whole response as JSON
                    return JSON.parse(content);
                }
            } catch (jsonError) {
                console.error('Error parsing JSON from response:', jsonError);
                // Fallback approach: If JSON parsing fails, try to extract information manually
                return extractItemsManually(content, currencySymbol);
            }
        }
        
        throw new Error('No valid response from Azure OpenAI');
        
    } catch (error) {
        console.error('Azure OpenAI Vision API call failed:', error);
        throw error;
    }
}

// Fallback function to extract items manually if JSON parsing fails
function extractItemsManually(text, currencySymbol) {
    const lines = text.split('\n');
    const items = [];
    let fullText = text;
    
    // Simple regex patterns to identify item lines
    const itemPatterns = [
        new RegExp(`([^:]+):\\s*[${currencySymbol}]?\\s*(\\d+(?:\\.\\d+)?)`),  // Item: $10.99
        new RegExp(`([^-]+)-\\s*[${currencySymbol}]?\\s*(\\d+(?:\\.\\d+)?)`),  // Item - $10.99
        new RegExp(`([^0-9]+)\\s+[${currencySymbol}]?\\s*(\\d+(?:\\.\\d+)?)`)  // Item   $10.99
    ];
    
    // Track previous item for potential discount association
    let previousItem = null;
    
    for (const line of lines) {
        // Skip empty lines
        if (!line.trim()) {
            continue;
        }
        
        // Check if line is a discount
        const isDiscount = line.includes('値引') || 
                          line.includes('discount') || 
                          line.toLowerCase().includes('off') ||
                          (line.includes('-') && /\d+/.test(line));
        
        if (isDiscount) {
            // Extract discount amount
            const amountMatch = line.match(/¥(\d+)/) || 
                               line.match(/(\d+)円/) || 
                               line.match(/-\s*(\d+)/) || 
                               null;
            const percentMatch = line.match(/(\d+)%/) || null;
            
            if (amountMatch) {
                const discountAmount = parseInt(amountMatch[1]);
                items.push({
                    name: percentMatch ? 
                        `Discount (${percentMatch[1]}%)` : 
                        "Discount",
                    price: -discountAmount,
                    isDiscount: true
                });
            }
            
            continue;
        }
        
        // Skip lines that look like totals or tax
        if (/total|subtotal|tax|sum|amount|合計|税/i.test(line)) {
            continue;
        }
        
        // Try each item pattern
        for (const pattern of itemPatterns) {
            const match = line.match(pattern);
            if (match) {
                const name = match[1].trim();
                const price = parseFloat(match[2]);
                
                if (name && !isNaN(price) && price !== 0) {
                    // Store as previous item
                    previousItem = { name, price };
                    items.push(previousItem);
                }
                break;
            }
        }
    }
    
    return { items, fullText };
}

// Helper function to clean up item names
function cleanupItemName(name) {
    if (!name) return '';
    
    // Remove item codes (numbers at start)
    let cleaned = name.replace(/^\d+\s+/, '');
    
    // Remove common prefixes often found in Japanese receipts
    cleaned = cleaned.replace(/^(light|scan|register|no\.|商品|品番|番号|ｺｰﾄﾞ|コード)/i, '');
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
}

// Function to show the add item form
function showAddItemForm() {
    document.getElementById('add-item-form').classList.remove('hidden');
    document.getElementById('item-name').focus();
}

// Function to hide the add item form
function hideAddItemForm() {
    document.getElementById('add-item-form').classList.add('hidden');
    document.getElementById('item-name').value = '';
    document.getElementById('item-price').value = '';
}

// Function to add a new item manually
function addItem() {
    const itemName = document.getElementById('item-name').value.trim();
    const itemPrice = parseFloat(document.getElementById('item-price').value);
    
    if (itemName === '' || isNaN(itemPrice)) {
        showSnackbar('Please enter a valid item name and price');
        return;
    }
    
    // Check if it's a discount
    const isDiscount = itemName.toLowerCase().includes('discount') || itemPrice < 0;
    
    // Create new item object
    const newItem = {
        id: Date.now(), // Unique ID using timestamp
        name: itemName,
        price: itemPrice,
        isDiscount: isDiscount,
        isMine: false,
        isFriend: false,
        isShared: false
    };
    
    // Add to items array
    items.push(newItem);
    
    // Update the display
    renderItems();
    updateTotals();
    
    // Clear input fields and hide form
    document.getElementById('item-name').value = '';
    document.getElementById('item-price').value = '';
    hideAddItemForm();
    
    showSnackbar('Item added successfully');
}

// Function to toggle edit mode
function toggleEditMode() {
    isEditMode = !isEditMode;
    const editButton = document.getElementById('edit-mode');
    
    if (isEditMode) {
        editButton.innerHTML = '<i class="fas fa-check"></i> Done Editing';
    } else {
        editButton.innerHTML = '<i class="fas fa-edit"></i> Edit Items';
    }
    
    renderItems();
}

// Function to render all items in the table
// Modified renderItems function to add click event to item names
function renderItems() {
    const tableBody = document.getElementById('items-body');
    tableBody.innerHTML = '';
    
    // Get currency symbol from settings if available
    const currencySymbol = document.getElementById('currency-symbol') ? 
        document.getElementById('currency-symbol').value : '¥';
    
    // Determine if using Japanese yen
    const isJapaneseYen = currencySymbol === '¥';
    
    // Render all items in their original order
    items.forEach(item => {
        const row = document.createElement('tr');
        
        // Add a class for discount items for styling
        if (item.isDiscount || item.price < 0) {
            row.className = 'discount-item';
        }
        
        // Format price appropriately
        const isDiscount = item.isDiscount || item.price < 0;
        const priceValue = isDiscount ? Math.abs(item.price) : item.price;
        const formattedPrice = isJapaneseYen ? 
            Math.round(priceValue).toLocaleString() : 
            priceValue.toFixed(2);
        
        if (isEditMode) {
            row.className += ' editable';
            
            if (isDiscount) {
                row.innerHTML = `
                    <td><input type="text" value="${item.name}" onchange="updateItemName('${item.id}', this.value)"></td>
                    <td><input type="number" value="${isJapaneseYen ? Math.round(Math.abs(item.price)) : Math.abs(item.price).toFixed(2)}" step="${isJapaneseYen ? '1' : '0.01'}" onchange="updateDiscountPrice('${item.id}', this.value)"></td>
                    <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
                `;
            } else {
                row.innerHTML = `
                    <td><input type="text" value="${item.name}" onchange="updateItemName('${item.id}', this.value)"></td>
                    <td><input type="number" value="${isJapaneseYen ? Math.round(item.price) : item.price.toFixed(2)}" step="${isJapaneseYen ? '1' : '0.01'}" onchange="updateItemPrice('${item.id}', this.value)"></td>
                    <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
                `;
            }
        } else {
            if (isDiscount) {
                row.innerHTML = `
                    <td class="item-name-cell" data-id="${item.id}">${item.name}</td>
                    <td>${currencySymbol}${formattedPrice} (-)</td>
                    <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
                `;
            } else {
                row.innerHTML = `
                    <td class="item-name-cell" data-id="${item.id}">${item.name}</td>
                    <td>${currencySymbol}${formattedPrice}</td>
                    <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                    <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
                `;
            }
        }
        
        tableBody.appendChild(row);
    });
    
    // Add click event listeners to item names for Google search
    document.querySelectorAll('.item-name-cell').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.title = 'Click to search this item on Google Images';
        
        cell.addEventListener('click', function() {
            const itemId = this.getAttribute('data-id');
            const item = items.find(i => i.id == itemId);
            if (item) {
                searchItemOnGoogle(item.name);
            }
        });
    });
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.mine-check').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const itemId = this.getAttribute('data-id');
            const item = items.find(i => i.id == itemId);
            
            if (!item) return;
            
            item.isMine = this.checked;
            
            // If marked as mine, uncheck friend and shared
            if (this.checked) {
                item.isFriend = false;
                item.isShared = false;
                renderItems(); // Re-render to update other checkboxes
            }
            
            updateTotals();
        });
    });
    
    document.querySelectorAll('.friend-check').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const itemId = this.getAttribute('data-id');
            const item = items.find(i => i.id == itemId);
            
            if (!item) return;
            
            item.isFriend = this.checked;
            
            // If marked as friend's, uncheck mine and shared
            if (this.checked) {
                item.isMine = false;
                item.isShared = false;
                renderItems(); // Re-render to update other checkboxes
            }
            
            updateTotals();
        });
    });
    
    document.querySelectorAll('.shared-check').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const itemId = this.getAttribute('data-id');
            const item = items.find(i => i.id == itemId);
            
            if (!item) return;
            
            item.isShared = this.checked;
            
            // If marked as shared, uncheck mine and friend
            if (this.checked) {
                item.isMine = false;
                item.isFriend = false;
                renderItems(); // Re-render to update other checkboxes
            }
            
            updateTotals();
        });
    });
}

// Add some CSS to make the item name cell look clickable
document.addEventListener('DOMContentLoaded', function() {
    // Create a style element
    const style = document.createElement('style');
    
    // Add CSS rules
    style.textContent = `
        .item-name-cell {
            color: #0066cc;
            text-decoration: underline;
            cursor: pointer;
            transition: color 0.2s;
        }
        
        .item-name-cell:hover {
            color: #004080;
            background-color: rgba(0, 102, 204, 0.1);
        }
    `;
    
    // Append to the head
    document.head.appendChild(style);
});

// Functions to update item details when in edit mode
function updateItemName(itemId, newName) {
    const item = items.find(i => i.id == itemId);
    if (item) {
        item.name = newName;
        
        // Update isDiscount flag if name contains "discount"
        item.isDiscount = item.price < 0 || newName.toLowerCase().includes('discount');
    }
}

function updateItemPrice(itemId, newPrice) {
    const item = items.find(i => i.id == itemId);
    const price = parseFloat(newPrice);
    
    if (item && !isNaN(price)) {
        item.price = price;
        
        // Update isDiscount flag if price is negative
        item.isDiscount = price < 0 || (item.name && item.name.toLowerCase().includes('discount'));
        
        updateTotals();
    }
}

function updateDiscountPrice(itemId, newPrice) {
    const item = items.find(i => i.id == itemId);
    const absolutePrice = parseFloat(newPrice);
    
    if (item && !isNaN(absolutePrice)) {
        // Store discount as negative value
        item.price = -absolutePrice;
        updateTotals();
    }
}

// Function to update totals
function updateTotals() {
    let mySubtotal = 0;
    let friendSubtotal = 0;
    
    // Get currency symbol if available
    const currencySymbol = document.getElementById('currency-symbol') ? 
        document.getElementById('currency-symbol').value : '¥';
    
    // Determine if using Japanese yen
    const isJapaneseYen = currencySymbol === '¥';
    
    items.forEach(item => {
        if (item.isMine) {
            mySubtotal += item.price;
        } else if (item.isFriend) {
            friendSubtotal += item.price;
        } else if (item.isShared) {
            // Split evenly for shared items
            mySubtotal += item.price / 2;
            friendSubtotal += item.price / 2;
        }
    });
    
    // Calculate tax amounts
    const myTax = mySubtotal * (taxRate / 100);
    const friendTax = friendSubtotal * (taxRate / 100);
    
    // Calculate totals with tax
    const myTotal = mySubtotal + myTax;
    const friendTotal = friendSubtotal + friendTax;
    
    // Format number based on currency
    const formatNumber = (num) => {
        if (isJapaneseYen) {
            return Math.round(num).toLocaleString();
        } else {
            return num.toFixed(2);
        }
    };
    
    // Update the DOM
    document.getElementById('my-subtotal').textContent = `${currencySymbol}${formatNumber(mySubtotal)}`;
    document.getElementById('friend-subtotal').textContent = `${currencySymbol}${formatNumber(friendSubtotal)}`;
    
    document.getElementById('my-tax').textContent = `${currencySymbol}${formatNumber(myTax)}`;
    document.getElementById('friend-tax').textContent = `${currencySymbol}${formatNumber(friendTax)}`;
    
    document.getElementById('my-total').textContent = `${currencySymbol}${formatNumber(myTotal)}`;
    document.getElementById('friend-total').textContent = `${currencySymbol}${formatNumber(friendTotal)}`;
    
    // Update receipt total
    const receiptTotal = myTotal + friendTotal;
    document.getElementById('receipt-total').textContent = `${currencySymbol}${formatNumber(receiptTotal)}`;
}

// Function to clear all items
function clearItems() {
    if (items.length === 0) return;
    
    if (confirm('Are you sure you want to clear all items?')) {
        items = [];
        renderItems();
        updateTotals();
        showSnackbar('All items cleared');
    }
}

// Function to save the current receipt
function saveReceipt() {
    if (items.length === 0) {
        showSnackbar('There are no items to save');
        return;
    }
    
    const receiptName = prompt('Enter a name for this receipt:', 'Shopping ' + new Date().toLocaleDateString());
    
    if (!receiptName) return; // User cancelled
    
    const currencySymbol = document.getElementById('currency-symbol') ? 
        document.getElementById('currency-symbol').value : '¥';
    
    const myTotal = parseFloat(document.getElementById('my-total').textContent.replace(currencySymbol, '').replace(/,/g, ''));
    const friendTotal = parseFloat(document.getElementById('friend-total').textContent.replace(currencySymbol, '').replace(/,/g, ''));
    
    const receipt = {
        id: Date.now(),
        name: receiptName,
        date: new Date().toISOString(),
        items: [...items],
        taxRate: taxRate,
        currency: currencySymbol,
        mySubtotal: parseFloat(document.getElementById('my-subtotal').textContent.replace(currencySymbol, '').replace(/,/g, '')),
        friendSubtotal: parseFloat(document.getElementById('friend-subtotal').textContent.replace(currencySymbol, '').replace(/,/g, '')),
        myTax: parseFloat(document.getElementById('my-tax').textContent.replace(currencySymbol, '').replace(/,/g, '')),
        friendTax: parseFloat(document.getElementById('friend-tax').textContent.replace(currencySymbol, '').replace(/,/g, '')),
        myTotal: myTotal,
        friendTotal: friendTotal,
        receiptTotal: myTotal + friendTotal
    };
    
    // Add to receipts array
    receipts.push(receipt);
    
    // Save to local storage
    localStorage.setItem('receipts', JSON.stringify(receipts));
    
    // Update history list
    renderHistory();
    
    // Clear current items
    clearItems();
    
    showSnackbar('Receipt saved successfully!');
}

// Function to load a saved receipt
function loadReceipt(receiptId) {
    const receipt = receipts.find(r => r.id === receiptId);
    
    if (!receipt) return;
    
    if (confirm(`Load receipt "${receipt.name}"? Current items will be cleared.`)) {
        items = [...receipt.items];
        
        // If the receipt has a tax rate, use it
        if (receipt.taxRate !== undefined) {
            taxRate = receipt.taxRate;
            document.getElementById('tax-rate').value = taxRate;
            document.getElementById('tax-info').textContent = `${taxRate}% tax is applied automatically to the total`;
        }
        
        // If the receipt has a currency and the selector exists, set it
        if (receipt.currency && document.getElementById('currency-symbol')) {
            document.getElementById('currency-symbol').value = receipt.currency;
        }
        
        renderItems();
        updateTotals();
        showSnackbar(`Loaded receipt: ${receipt.name}`);
    }
}

// Function to load saved receipts from local storage
function loadSavedReceipts() {
    const savedReceipts = localStorage.getItem('receipts');
    
    if (savedReceipts) {
        receipts = JSON.parse(savedReceipts);
        renderHistory();
    }
}

// Function to save Azure API settings
function saveApiSettings() {
    const endpoint = document.getElementById('azure-endpoint').value.trim();
    const apiKey = document.getElementById('azure-key').value.trim();
    const model = document.getElementById('azure-model').value.trim();
    
    if (!endpoint || !apiKey) {
        showSnackbar('Please enter both Azure endpoint and API key');
        return;
    }
    
    // Save to global variables
    AZURE_OPENAI_ENDPOINT = endpoint;
    AZURE_OPENAI_API_KEY = apiKey;
    
    if (model) {
        AZURE_OPENAI_MODEL = model;
    }
    
    // Save to localStorage (encrypted would be better for production)
    localStorage.setItem('azure_openai_endpoint', endpoint);
    localStorage.setItem('azure_openai_api_key', apiKey);
    localStorage.setItem('azure_openai_model', AZURE_OPENAI_MODEL);
    
    showSnackbar('Azure OpenAI API settings saved successfully');
    
    // Close the details section
    document.querySelector('.api-settings details').removeAttribute('open');
}

// Function to load Azure API settings from localStorage
function loadApiSettings() {
    const savedEndpoint = localStorage.getItem('azure_openai_endpoint');
    const savedApiKey = localStorage.getItem('azure_openai_api_key');
    const savedModel = localStorage.getItem('azure_openai_model');
    
    if (savedEndpoint && savedApiKey) {
        // Set global variables
        AZURE_OPENAI_ENDPOINT = savedEndpoint;
        AZURE_OPENAI_API_KEY = savedApiKey;
        
        // Set form fields
        document.getElementById('azure-endpoint').value = savedEndpoint;
        document.getElementById('azure-key').value = savedApiKey;
    }
    
    if (savedModel) {
        AZURE_OPENAI_MODEL = savedModel;
        document.getElementById('azure-model').value = savedModel;
    }
}

// Function to render receipt history
function renderHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    // Sort receipts by date (newest first)
    const sortedReceipts = [...receipts].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedReceipts.forEach(receipt => {
        const listItem = document.createElement('li');
        
        const date = new Date(receipt.date).toLocaleDateString();
        const currency = receipt.currency || '¥';
        
        // Format based on currency
        const formatAmount = (amount) => {
            if (currency === '¥') {
                return Math.round(amount).toLocaleString();
            } else {
                return amount.toFixed(2);
            }
        };
        
        listItem.innerHTML = `
            <div class="history-item-details">
                <span class="history-item-name">${receipt.name}</span>
                <span class="history-item-date">${date}</span>
            </div>
            <div class="history-item-totals">
                <div>You: ${currency}${formatAmount(receipt.myTotal)}</div>
                <div>Friend: ${currency}${formatAmount(receipt.friendTotal)}</div>
            </div>
        `;
        
        listItem.addEventListener('click', function() {
            loadReceipt(receipt.id);
        });
        
        historyList.appendChild(listItem);
    });
    
    if (sortedReceipts.length === 0) {
        historyList.innerHTML = '<li>No saved receipts</li>';
    }
}

// Function to show a snackbar notification
function showSnackbar(message) {
    const snackbar = document.getElementById('snackbar');
    snackbar.textContent = message;
    snackbar.className = 'show';
    
    // After 3 seconds, remove the show class
    setTimeout(function() { 
        snackbar.className = snackbar.className.replace('show', ''); 
    }, 3000);
}
function searchItemOnGoogle(itemName) {
  if (!itemName) return;
  
  // Clean up the item name to make it more search-friendly
  const cleanedName = itemName.trim();
  
  // Create a Google Images search URL
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanedName)}&tbm=isch`;
  
  // Open in a new tab
  window.open(searchUrl, '_blank');
}
