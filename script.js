// Global variables
let items = [];
let receipts = [];
let isEditMode = false;
let taxRate = 10; // Default tax rate for Japan (10%)

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
    
    // Initialize tax rate from input
    document.getElementById('tax-rate').value = taxRate;
    
    // Initialize currency selector if it exists
    if (document.getElementById('currency-symbol')) {
        document.getElementById('currency-symbol').addEventListener('change', function() {
            renderItems();
            updateTotals();
        });
    }
    
    // Photo upload handling
    const photoInput = document.getElementById('receipt-photo');
    
    photoInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const previewDiv = document.getElementById('photo-preview');
                previewDiv.innerHTML = `<img src="${e.target.result}" alt="Receipt preview">`;
                document.getElementById('process-photo').disabled = false;
            }
            
            reader.readAsDataURL(e.target.files[0]);
        }
    });
    
    // Load saved receipts from local storage
    loadSavedReceipts();
});

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

// Function to process the receipt image using Tesseract OCR
async function processReceiptImage() {
    const photoInput = document.getElementById('receipt-photo');
    
    if (!photoInput.files || !photoInput.files[0]) {
        showSnackbar('Please upload a receipt image first');
        return;
    }
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    loadingIndicator.classList.remove('hidden');
    
    // Progress display
    const progressElement = document.getElementById('progress');
    
    try {
        // Get language setting if available
        const language = document.getElementById('ocr-language') ? 
            document.getElementById('ocr-language').value : 'eng';
        
        // Using the proper Tesseract.js v4 API
        const result = await Tesseract.recognize(
            photoInput.files[0],
            language,
            {
                logger: m => {
                    console.log(m);
                    if (m.status === 'recognizing text') {
                        progressElement.style.width = `${m.progress * 100}%`;
                    }
                }
            }
        );
        
        console.log('OCR Result:', result);
        
        // Show OCR output in debug area if it exists
        if (document.getElementById('ocr-debug-output')) {
            document.getElementById('ocr-debug-output').textContent = result.data.text;
            document.getElementById('ocr-debug').classList.remove('hidden');
        }
        
        // Process the OCR result
        parseJapaneseReceiptText(result.data.text);
        
    } catch (error) {
        console.error('OCR Error:', error);
        showSnackbar('Error processing the receipt. Please try again with a clearer image');
    } finally {
        // Hide loading indicator
        loadingIndicator.classList.add('hidden');
    }
}

// Function to parse Japanese receipt text (including translated to English)
function parseJapaneseReceiptText(text) {
    // Split by lines
    const lines = text.split('\n').filter(line => line.trim() !== '');
    console.log('Lines detected:', lines);
    
    // Reset items array
    items = [];
    
    // Patterns to find prices and items
    const pricePatterns = [
        /[¥￥](\d[\d,]*)/,                  // ¥ followed by digits
        /(\d+)\s*[¥￥]/,                    // digits followed by ¥
        /[¥￥]\s*(\d[\d,]*)/,               // ¥ and digits with possible space
        /[¥￥]\s*([\d,]+\.\d{2})/,          // ¥ and decimal (rare in JPY)
        /-[¥￥]\s*(\d[\d,]*)/,              // negative prices (discounts)
        /-(\d[\d,]*)/                       // just negative number
    ];
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip very short lines or lines that look like headers/totals
        if (line.length < 3) {
            continue;
        }
        
        // Skip lines that look like totals, subtotals, or other non-item lines
        if (/total|subtotal|tax|sum|discount|credit|register/i.test(line) && 
            !/discount.*\d+%/.test(line)) { // Keep discount lines with percent
            continue;
        }
        
        // Try to find price using multiple patterns
        let priceMatch = null;
        let matchedPattern = null;
        let price = null;
        
        for (const pattern of pricePatterns) {
            priceMatch = line.match(pattern);
            if (priceMatch) {
                matchedPattern = pattern;
                break;
            }
        }
        
        // If we found a price match
        if (priceMatch) {
            // Extract the price - remove commas and convert to number
            const priceStr = priceMatch[1].replace(/,/g, '');
            price = parseFloat(priceStr);
            
            // For negative patterns, make the price negative
            if (matchedPattern.toString().includes('-') && price > 0) {
                price = -price;
            }
            
            // Find where the price appears in the line
            const priceIndex = line.indexOf(priceMatch[0]);
            
            // Extract item name based on price position
            let itemName = '';
            if (priceIndex > 0) {
                // If price is on the right (typical), item name is before it
                itemName = line.substring(0, priceIndex).trim();
            } else if (priceIndex === 0 && i > 0) {
                // If price is at the start, item might be on previous line
                itemName = lines[i-1].trim();
            }
            
            // Clean up item name
            itemName = cleanupItemName(itemName);
            
            // For discounts
            const isDiscount = price < 0 || /discount/i.test(itemName);
            
            // Add to items if we have both name and price
            if (itemName && !isNaN(price)) {
                items.push({
                    id: Date.now() + Math.random(), // Unique ID
                    name: isDiscount ? "Discount" : itemName,
                    price: price,
                    isMine: false,
                    isFriend: false,
                    isShared: false
                });
            }
        } else {
            // Try to find numbers at the end of the line (likely prices)
            const numberMatch = line.match(/(\d[\d,]+)(?:\s*)$/);
            if (numberMatch) {
                const priceCandidate = parseFloat(numberMatch[1].replace(/,/g, ''));
                
                if (!isNaN(priceCandidate) && priceCandidate > 0 && priceCandidate < 100000) {
                    // This is likely a price without a ¥ symbol
                    const priceIndex = line.lastIndexOf(numberMatch[1]);
                    let itemName = line.substring(0, priceIndex).trim();
                    
                    // Clean up item name
                    itemName = cleanupItemName(itemName);
                    
                    if (itemName) {
                        items.push({
                            id: Date.now() + Math.random(),
                            name: itemName,
                            price: priceCandidate,
                            isMine: false,
                            isFriend: false,
                            isShared: false
                        });
                    }
                }
            }
        }
    }
    
    // Fallback: scan for item-price patterns on adjacent lines
    if (items.length === 0) {
        for (let i = 0; i < lines.length - 1; i++) {
            const currentLine = lines[i].trim();
            const nextLine = lines[i + 1].trim();
            
            // If current line doesn't have numbers but next line is just a number
            if (!/\d/.test(currentLine) && /^[¥￥]?\s*\d+(\.\d{2})?$/.test(nextLine)) {
                const priceStr = nextLine.replace(/[¥￥\s]/g, '');
                const price = parseFloat(priceStr);
                
                if (!isNaN(price) && price > 0) {
                    const itemName = cleanupItemName(currentLine);
                    
                    if (itemName) {
                        items.push({
                            id: Date.now() + Math.random(),
                            name: itemName,
                            price: price,
                            isMine: false,
                            isFriend: false,
                            isShared: false
                        });
                    }
                }
            }
        }
    }
    
    // Update the display
    renderItems();
    updateTotals();
    
    // Notify user
    if (items.length > 0) {
        showSnackbar(`Detected ${items.length} items. Please check and assign them`);
    } else {
        showSnackbar('No items could be detected. Try uploading a clearer image or add items manually');
    }
}

// Helper function to clean up item names
function cleanupItemName(name) {
    if (!name) return '';
    
    // Remove item codes (numbers at start)
    let cleaned = name.replace(/^\d+\s+/, '');
    
    // Remove common prefixes often found in Japanese receipts
    cleaned = cleaned.replace(/^(light|scan|register|no\.)/i, '');
    
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
    
    // Create new item object
    const newItem = {
        id: Date.now(), // Unique ID using timestamp
        name: itemName,
        price: itemPrice,
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
function renderItems() {
    const tableBody = document.getElementById('items-body');
    tableBody.innerHTML = '';
    
    // Get currency symbol from settings if available
    const currencySymbol = document.getElementById('currency-symbol') ? 
        document.getElementById('currency-symbol').value : '¥';
    
    // Determine if using Japanese yen
    const isJapaneseYen = currencySymbol === '¥';
    
    items.forEach(item => {
        const row = document.createElement('tr');
        
        // Format price appropriately
        const formattedPrice = isJapaneseYen ? 
            Math.round(item.price).toLocaleString() : 
            item.price.toFixed(2);
        
        if (isEditMode) {
            row.className = 'editable';
            row.innerHTML = `
                <td><input type="text" value="${item.name}" onchange="updateItemName('${item.id}', this.value)"></td>
                <td><input type="number" value="${isJapaneseYen ? Math.round(item.price) : item.price.toFixed(2)}" step="${isJapaneseYen ? '1' : '0.01'}" onchange="updateItemPrice('${item.id}', this.value)"></td>
                <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
            `;
        } else {
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${currencySymbol}${formattedPrice}</td>
                <td><input type="checkbox" class="mine-check" data-id="${item.id}" ${item.isMine ? 'checked' : ''}></td>
                <td><input type="checkbox" class="friend-check" data-id="${item.id}" ${item.isFriend ? 'checked' : ''}></td>
                <td><input type="checkbox" class="shared-check" data-id="${item.id}" ${item.isShared ? 'checked' : ''}></td>
            `;
        }
        
        tableBody.appendChild(row);
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

// Functions to update item details when in edit mode
function updateItemName(itemId, newName) {
    const item = items.find(i => i.id == itemId);
    if (item) {
        item.name = newName;
    }
}

function updateItemPrice(itemId, newPrice) {
    const item = items.find(i => i.id == itemId);
    const price = parseFloat(newPrice);
    
    if (item && !isNaN(price)) {
        item.price = price;
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

// Function to load saved receipts from local storage
function loadSavedReceipts() {
    const savedReceipts = localStorage.getItem('receipts');
    
    if (savedReceipts) {
        receipts = JSON.parse(savedReceipts);
        renderHistory();
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