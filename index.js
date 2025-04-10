// public/extensions/third-party/my-favorites-plugin/index.js

// Import from the core script (public/script.js)
import {
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    // messageFormatting,
    chat, // Need access to the current chat array for preview filling
    doNewChat, // To create the preview chat
    clearChat, // To clear the preview chat on entry
    renameChat, // To name the preview chat
    openCharacterChat, // To switch to the preview chat (for characters)
    addOneMessage, // To fill the preview chat
    this_chid, // To know the current character ID
    saveChatConditional, // Potentially needed? Or avoided? Let's try avoiding first.
    is_send_press, // Check generation status
    isChatSaving, // Check saving status
} from '../../../../script.js';

// Import from the extension helper script (public/scripts/extensions.js)
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
} from '../../../extensions.js';

// Import from the Popup utility script (public/scripts/popup.js)
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script (public/scripts/utils.js)
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// Import group chat functions (if supporting groups)
import {
    selected_group, // To know the current group ID
    openGroupChat, // To switch to the preview chat (for groups)
    is_group_generating, // Check group generation status
} from '../../../group-chats.js';

import { t } from '../../../i18n.js';

// jQuery ($) is globally available

(function () { // Use IIFE to encapsulate plugin logic

    const pluginName = 'star2';
    const pluginFolderName = 'star2'; // Matches the actual folder name
    const logPrefix = `[${pluginName}]`;

    // --- Constants ---
    const favIconClass = 'favorite-toggle-icon';
    const favIconSelector = `.${favIconClass}`;
    const favoritedIconClass = 'fa-solid fa-star'; // Gold, solid star
    const unfavoritedIconClass = 'fa-regular fa-star'; // Hollow star
    const settingsContainerId = 'favorites-plugin-settings-area';
    const sidebarButtonId = 'my_favorites_sidebar_button';
    const popupListContainerId = 'favorites-popup-list-container';
    const popupPaginationId = 'favorites-popup-pagination';
    const pluginPageListContainerId = 'favorites-plugin-page-list';
    const pluginPagePaginationId = 'favorites-plugin-page-pagination';
    const itemsPerPagePopup = 10;
    const itemsPerPagePluginPage = 20;
    const previewButtonId = 'fav-popup-preview'; // ID for the new preview button
    const previewChatName = "<预览聊天>"; // Name for the preview chat
    const previewChatMappingKey = 'previewChats'; // Key in settings to store mappings
    const previewChatActiveMarker = 'favorites-plugin-preview-active'; // Class to add when preview is active
    const interactionSelectors = '#send_textarea, #send_button, #send_button_edit, #send_form'; // Elements to disable in preview

    // --- HTML Snippets ---
    const messageButtonHtml = `
        <div class="mes_button ${favIconClass}" title="Favorite/Unfavorite Message">
            <i class="${unfavoritedIconClass}"></i>
        </div>
    `;
     // Added button for the popup
     const previewButtonHtml = `<button id="${previewButtonId}" class="menu_button" title="Preview favorites in a temporary chat">预览</button>`;

    // --- Global State ---
    let favoritesPopup = null; // Stores the Popup instance
    let currentPopupChatId = null; // Tracks which chat the popup is showing
    let currentPopupPage = 1;
    let currentPluginPagePage = 1;
    let isInPreviewMode = false; // Tracks if we are currently in a preview chat
    let originalContextBeforePreview = null; // Store context before entering preview


    // --- Core Data Functions ---

    /**
     * Ensures the plugin's settings object and preview mapping exists.
     */
    function initializeSettings() {
        if (!extension_settings[pluginName]) {
            extension_settings[pluginName] = { chats: {}, [previewChatMappingKey]: {} };
            console.log(logPrefix, 'Initialized settings.');
        }
        // Ensure 'chats' sub-object exists
        if (!extension_settings[pluginName].chats) {
            extension_settings[pluginName].chats = {};
        }
        // Ensure preview mapping object exists
        if (!extension_settings[pluginName][previewChatMappingKey]) {
            extension_settings[pluginName][previewChatMappingKey] = {};
        }
    }

    /**
     * Gets the plugin's settings object.
     * @returns {object} The plugin settings.
     */
    function getPluginSettings() {
        initializeSettings(); // Ensure it's initialized before accessing
        return extension_settings[pluginName];
    }

    /**
     * Gets the preview chat ID associated with an original chat ID.
     * @param {string} originalChatId The ID of the original chat.
     * @returns {string|null} The preview chat ID or null if none exists.
     */
    function getPreviewChatId(originalChatId) {
        const settings = getPluginSettings();
        return settings[previewChatMappingKey]?.[originalChatId] || null;
    }

    /**
     * Stores the mapping between an original chat ID and its preview chat ID.
     * @param {string} originalChatId The ID of the original chat.
     * @param {string} previewChatId The ID of the newly created preview chat.
     */
    function storePreviewChatId(originalChatId, previewChatId) {
        const settings = getPluginSettings();
        settings[previewChatMappingKey][originalChatId] = previewChatId;
        saveSettingsDebounced();
        console.log(logPrefix, `Stored preview chat mapping: ${originalChatId} -> ${previewChatId}`);
    }

    /**
     * Gets chat info for the current context.
     * Handles both character and group chats.
     * @returns {object|null} { chatId, type, name, characterId?, groupId?, chatMessages: Array<object> } or null if context unavailable.
     */
    function getCurrentChatInfo() {
        try {
            const context = getContext();
            const currentChatId = getCurrentChatId(); // Get current active chat ID
            if (!currentChatId) return null;

            let type, name, characterId, groupId, entityId;
            const chatMessages = [...context.chat]; // Get a copy of the current chat messages

            // Determine type and IDs based on context
            if (context.groupId) { // It's a group chat
                type = "group";
                groupId = context.groupId;
                entityId = groupId; // Use groupId as the main identifier for groups
                const group = context.groups?.find(g => g.id === groupId);
                name = group ? group.name : `Group ${groupId}`;
                 // Important: Ensure the chatId from context matches the active one for the group
                 if(group?.chat_id !== currentChatId){
                     console.warn(logPrefix, `Mismatch: Context group chat_id (${group?.chat_id}) vs currentChatId (${currentChatId}). Using currentChatId.`);
                 }
            } else if (context.characterId !== undefined && context.characterId !== null) { // It's a character chat
                type = "private";
                characterId = context.characterId;
                entityId = characterId; // Use characterId as the main identifier for private chats
                name = context.name2; // Character name
                 // Important: Ensure the chatId from context matches the active one for the character
                 const character = context.characters?.find(c => c.id === characterId);
                 if(character?.chat !== currentChatId){
                     console.warn(logPrefix, `Mismatch: Context character chat (${character?.chat}) vs currentChatId (${currentChatId}). Using currentChatId.`);
                 }
            } else {
                // Fallback or unknown state (e.g., system messages page)
                console.warn(logPrefix, "Could not determine character or group context for current chat:", currentChatId);
                return null;
            }

            return { chatId: currentChatId, type, name, characterId, groupId, entityId, chatMessages };
        } catch (error) {
            console.error(logPrefix, "Error getting current chat info:", error);
            return null;
        }
    }

     /**
     * Gets a specific chat message object from a provided message array.
     * @param {Array<object>} chatArray The array of message objects to search within.
     * @param {string|number} messageId The ID of the message to find.
     * @returns {object|null} The message object or null if not found.
     */
     function getChatMessageById(chatArray, messageId) {
         if (!chatArray) return null;
        try {
            // Ensure messageId is parsed correctly if it's sometimes a string/number
            const targetId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
            // Find message by 'id' property, assuming messages have unique numeric IDs
            return chatArray.find(msg => msg.id === targetId) || null;
        } catch (error) {
            // console.warn(logPrefix, `Could not get message ${messageId} from provided chat array:`, error);
            return null;
        }
    }

    /**
     * Finds and collects the full message objects for favorited items from the original chat.
     * @param {Array<object>} originalChatMessages - The full message array from the original chat context.
     * @param {Array<object>} favoriteItems - The list of favorite item objects (containing messageId).
     * @returns {Array<object>} An array containing the full message objects for found favorites.
     */
    function findFullMessagesForPreview(originalChatMessages, favoriteItems) {
        const fullMessages = [];
        if (!originalChatMessages || !favoriteItems) {
            console.error(logPrefix, "Missing original messages or favorite items for preview.");
            return fullMessages;
        }

        const originalMessageMap = new Map();
        originalChatMessages.forEach(msg => originalMessageMap.set(String(msg.id), msg));

        favoriteItems.forEach(favItem => {
            const stringMessageId = String(favItem.messageId);
            const fullMessage = originalMessageMap.get(stringMessageId);
            if (fullMessage) {
                // Create a deep copy to avoid modifying the original context's objects
                fullMessages.push(JSON.parse(JSON.stringify(fullMessage)));
            } else {
                console.warn(logPrefix, `Favorite item references message ID ${favItem.messageId}, but it was not found in the original chat messages.`);
                // Optionally create a placeholder message here?
                // fullMessages.push({ is_system: true, name: "System", mes: `[Favorite for deleted message ID: ${favItem.messageId}]`, id: favItem.messageId, send_date: favItem.timestamp });
            }
        });

        // Sort messages by timestamp (or original ID) to maintain order
        fullMessages.sort((a, b) => (a.send_date || a.id) - (b.send_date || b.id));

        console.log(logPrefix, `Found ${fullMessages.length} full messages out of ${favoriteItems.length} favorites for preview.`);
        return fullMessages;
    }

    /**
     * Clears the chat and fills it with the provided messages.
     * @param {Array<object>} messagesToFill - Array of full message objects to display.
     */
    async function populatePreviewChat(messagesToFill) {
        console.log(logPrefix, "Populating preview chat...");
        try {
            clearChat(); // Clear the current chat interface and context.chat array
            console.log(logPrefix, "Preview chat cleared.");

            // Wait briefly for clearChat DOM operations to potentially finish
            await new Promise(resolve => setTimeout(resolve, 300));

            // Re-get context after clearing, though chat array should be empty now
            const currentContext = getContext();

            if (messagesToFill.length === 0) {
                console.log(logPrefix, "No messages to fill in preview chat.");
                 // Optionally add a message indicating it's empty or based on deleted items
                 await currentContext.addOneMessage({
                     is_system: true,
                     name: "System",
                     mes: "收藏夹为空或所有收藏的消息已被删除。",
                     id: 0, // Assign a temporary ID
                     send_date: Date.now() / 1000
                 }, { scroll: true, forceId: 0 });
                return;
            }

            console.log(logPrefix, `Starting to fill ${messagesToFill.length} messages...`);
            // Determine truncation limit (optional, could show all favorites)
            // const truncationLimit = getContext()?.power_user?.chat_truncation || messagesToFill.length;
            // const startIndex = Math.max(0, messagesToFill.length - truncationLimit);
            // const messagesToShow = messagesToFill.slice(startIndex);
            const messagesToShow = messagesToFill; // Show all for now

            for (let i = 0; i < messagesToShow.length; i++) {
                const message = messagesToShow[i];
                try {
                     // Use forceId to try and maintain original message ID in the DOM attribute
                    await currentContext.addOneMessage(message, {
                        scroll: i === messagesToShow.length - 1, // Scroll only on the last message
                        forceId: message.id // Pass original ID
                    });
                     // Short delay between messages can help ensure rendering order
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (addError) {
                    console.error(logPrefix, `Error adding message (ID: ${message.id}) to preview chat:`, addError);
                }
            }

            console.log(logPrefix, "Preview chat populated.");
            // Do NOT call saveChat or saveChatConditional here.
        } catch (error) {
            console.error(logPrefix, "Error during populatePreviewChat:", error);
            toastr.error("填充预览聊天时出错。");
        }
    }

     /**
     * Disables or enables chat interaction elements.
     * @param {boolean} disable True to disable, false to enable.
     */
    function toggleChatInteraction(disable) {
        const $elements = $(interactionSelectors);
        const $body = $('body');
        if (disable) {
            $elements.prop('disabled', true).css('opacity', 0.5);
            // Add a class to body or chat container for more specific CSS rules if needed
            $body.addClass(previewChatActiveMarker);
            console.log(logPrefix, "Chat interaction DISABLED for preview.");
            toastr.info("预览模式已激活。聊天交互已禁用。", null, { timeOut: 2000 });
        } else {
            $elements.prop('disabled', false).css('opacity', '');
            $body.removeClass(previewChatActiveMarker);
            console.log(logPrefix, "Chat interaction ENABLED.");
        }
    }

    // --- (Keep existing data functions: isFavorited, addFavorite, removeFavoriteById, removeFavoriteByMessageId) ---
    // ... (previous code for these functions) ...

    /**
     * Checks if a message is currently favorited.
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The message ID.
     * @returns {boolean} True if favorited, false otherwise.
     */
    function isFavorited(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items) return false;
        // Ensure comparison handles potential type mismatches (string vs number)
        const stringMessageId = String(messageId);
        return chatData.items.some(item => String(item.messageId) === stringMessageId);
    }

    /**
     * Adds a message to favorites.
     * @param {object} chatInfo - Result from getCurrentChatInfo(). Must include chatId, type, name, characterId?, groupId?.
     * @param {object} message - The message object from context.chat. Must include id, name, is_user, is_system, send_date.
     */
    function addFavorite(chatInfo, message) {
        if (!chatInfo || !message || !chatInfo.chatId || message.id === undefined) {
            console.error(logPrefix, "addFavorite: Missing critical chatInfo or message data.", { chatInfo, message });
            return;
        }
        const { chatId, type, name, characterId, groupId } = chatInfo;
        const settings = getPluginSettings();

        // Ensure chat entry exists
        if (!settings.chats[chatId]) {
            settings.chats[chatId] = {
                type: type,
                name: name || (type === 'group' ? `Group ${groupId}` : `Character ${characterId}`), // Fallback name
                characterId: characterId,
                groupId: groupId,
                count: 0,
                items: [],
            };
            // Update name/type if it exists already but lacks details
        } else {
             settings.chats[chatId].name = name || settings.chats[chatId].name; // Keep name potentially updated
             settings.chats[chatId].type = type || settings.chats[chatId].type;
             if (characterId !== undefined) settings.chats[chatId].characterId = characterId;
             if (groupId !== undefined) settings.chats[chatId].groupId = groupId;
             if (!settings.chats[chatId].items) settings.chats[chatId].items = [];
             if (typeof settings.chats[chatId].count !== 'number') settings.chats[chatId].count = 0;
        }


        // Check if already favorited (shouldn't happen if UI logic is correct, but good safeguard)
        if (isFavorited(chatId, message.id)) {
            console.warn(logPrefix, `Message ${message.id} in chat ${chatId} is already favorited.`);
            return;
        }

        const newItem = {
            id: uuidv4(), // Unique favorite ID
            messageId: String(message.id), // Store as string for consistency
            sender: message.name,
            role: message.is_user ? "user" : (message.is_system ? "system" : "character"),
            timestamp: message.send_date || Math.floor(Date.now() / 1000), // Use send_date, fallback to now
            note: "", // Initialize note as empty
        };

        settings.chats[chatId].items.push(newItem);
        settings.chats[chatId].count = settings.chats[chatId].items.length; // Recalculate count

        console.log(logPrefix, `Favorited message ${message.id} in chat ${chatId}. New count: ${settings.chats[chatId].count}`);
        saveSettingsDebounced();

        // Update popup if it's open for this chat
        if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
            updateFavoritesPopup(chatId, currentPopupPage); // Re-render popup
        }
         // Update plugin page if visible
        renderPluginPage();
    }

    /**
     * Removes a favorite by its unique favorite item ID.
     * @param {string} chatId The chat ID.
     * @param {string} favId The unique ID of the favorite item to remove.
     * @returns {boolean} True if removal was successful, false otherwise.
     */
    function removeFavoriteById(chatId, favId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            console.warn(logPrefix, `Cannot remove favorite: Chat ${chatId} not found or has no items.`);
            return false;
        }

        const initialLength = chatData.items.length;
        chatData.items = chatData.items.filter(item => item.id !== favId);
        const removed = chatData.items.length < initialLength;

        if (removed) {
            chatData.count = chatData.items.length;
            console.log(logPrefix, `Removed favorite ${favId} from chat ${chatId}. New count: ${chatData.count}`);

            // If chat becomes empty, remove the chat entry itself (optional, keeps history cleaner)
            // Consider keeping the chat entry even if empty if it has a preview chat associated?
            // Let's keep it simple for now: remove if empty.
            if (chatData.count === 0) {
                delete settings.chats[chatId];
                console.log(logPrefix, `Removed empty chat entry for ${chatId}.`);
                // Also remove preview mapping if the original chat entry is gone?
                if(settings[previewChatMappingKey]?.[chatId]){
                    delete settings[previewChatMappingKey][chatId];
                     console.log(logPrefix, `Removed preview mapping for deleted chat entry ${chatId}.`);
                }
            }
            saveSettingsDebounced();

            // Update popup if it's open for this chat
            if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
                // Go back a page if the current page becomes empty, unless it's the first page
                 const totalPages = Math.ceil((chatData.count || 0) / itemsPerPagePopup); // Use || 0 if chatData was deleted
                 if (currentPopupPage > totalPages && currentPopupPage > 1) {
                     currentPopupPage--;
                 }
                updateFavoritesPopup(chatId, currentPopupPage); // Re-render popup
            }
             // Update plugin page if visible
            renderPluginPage();

            return true;
        } else {
            console.warn(logPrefix, `Favorite with ID ${favId} not found in chat ${chatId}.`);
            return false;
        }
    }

    /**
     * Removes a favorite based on the original message ID.
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The original message ID.
     * @returns {boolean} True if removal was successful, false otherwise.
     */
     function removeFavoriteByMessageId(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            // console.warn(logPrefix, `Cannot remove favorite by messageId: Chat ${chatId} not found or has no items.`);
            return false; // Not necessarily an error if toggling an unfavorited message
        }

        const stringMessageId = String(messageId);
        const favItem = chatData.items.find(item => String(item.messageId) === stringMessageId);

        if (favItem) {
            return removeFavoriteById(chatId, favItem.id);
        } else {
            // console.warn(logPrefix, `Favorite for message ID ${messageId} not found in chat ${chatId}.`);
            return false; // Not favorited in the first place
        }
    }


    // --- UI Update Functions ---

    /**
     * Updates the visual state of a favorite icon on a specific message.
     * @param {jQuery} $messageElement - The jQuery object for the message container (.mes).
     * @param {boolean} isFav - True to show favorited state, false for default.
     */
    function updateFavoriteIconState($messageElement, isFav) {
        const $icon = $messageElement.find(favIconSelector + ' i');
        if ($icon.length) {
            if (isFav) {
                $icon.removeClass(unfavoritedIconClass).addClass(favoritedIconClass);
                $icon.closest(favIconSelector).attr('title', 'Unfavorite Message');
            } else {
                $icon.removeClass(favoritedIconClass).addClass(unfavoritedIconClass);
                 $icon.closest(favIconSelector).attr('title', 'Favorite Message');
            }
        } else {
             // console.warn(logPrefix, `Icon not found in message element for update:`, $messageElement.attr('mesid'));
        }
    }

    /**
     * Iterates through currently visible messages, injects the favorite icon if missing,
     * and updates its state based on stored data.
     */
    function injectOrUpdateFavoriteIcons() {
        const chatInfo = getCurrentChatInfo(); // Use the extended function
        if (!chatInfo || isInPreviewMode) return; // No active chat or in preview mode

        const chatId = chatInfo.chatId;
        // console.log(logPrefix, "Updating icons for chat:", chatId);

        // Select all message blocks currently in the DOM
        $('#chat .mes').each(function() {
            const $messageElement = $(this);
            const $extraButtons = $messageElement.find('.extraMesButtons');
            let $iconContainer = $extraButtons.find(favIconSelector);

            // 1. Inject icon if it doesn't exist
            if ($extraButtons.length && $iconContainer.length === 0) {
                // Prepend is often better visually for button order
                $extraButtons.prepend(messageButtonHtml);
                $iconContainer = $extraButtons.find(favIconSelector); // Re-select after adding
                // console.log(logPrefix, 'Injected icon for message:', $messageElement.attr('mesid'));
            }

            // 2. Update state if icon container exists
            if ($iconContainer.length > 0) {
                const messageId = $messageElement.attr('mesid');
                if (messageId !== undefined) { // Check for existence, 0 is a valid ID
                    const isFav = isFavorited(chatId, messageId);
                    updateFavoriteIconState($messageElement, isFav);
                } else {
                    // console.warn(logPrefix, "Message element missing mesid attribute:", $messageElement);
                }
            }
        });
        // console.log(logPrefix, "Icon update complete.");
    }


    // --- Event Handlers ---

     /**
     * Handles clicking the favorite icon on a message. Uses event delegation.
     * @param {Event} event - The click event object.
     */
    async function handleFavoriteToggle(event) {
        // Prevent toggle if in preview mode
        if (isInPreviewMode) {
            toastr.warning("无法在预览模式下修改收藏。");
            return;
        }

        const $iconContainer = $(event.target).closest(favIconSelector);
        if (!$iconContainer.length) return; // Click wasn't on the icon or its container

        const $messageElement = $iconContainer.closest('.mes');
        const messageId = $messageElement.attr('mesid');
        // Get current chat info INCLUDING messages to find the full object
        const chatInfo = getCurrentChatInfo();

        if (messageId === undefined || !chatInfo) {
            console.error(logPrefix, "Could not get messageId or chatInfo on toggle.");
            alert("错误：无法确定消息或聊天上下文。");
            return;
        }

        const chatId = chatInfo.chatId;
        const $icon = $iconContainer.find('i');

        // 1. Determine CURRENT state (visually)
        const isCurrentlyFavorited = $icon.hasClass(favoritedIconClass);

        // 2. Immediately toggle visual state
        updateFavoriteIconState($messageElement, !isCurrentlyFavorited);

        // 3. Call data function based on the NEW state
        if (!isCurrentlyFavorited) { // It WAS unfavorited, NEW state is favorited
            // Find the full message object from the current chat context
            const message = getChatMessageById(chatInfo.chatMessages, messageId);
            if (message) {
                addFavorite(chatInfo, message); // Pass full chatInfo and message
            } else {
                console.error(logPrefix, `Could not find message object for ID ${messageId} in current chat context to favorite.`);
                alert(`错误：找不到消息 ID ${messageId} 的数据。无法收藏。`);
                // Revert visual state on error
                updateFavoriteIconState($messageElement, false);
            }
        } else { // It WAS favorited, NEW state is unfavorited
            removeFavoriteByMessageId(chatId, messageId);
        }
    }


    /**
     * Handles clicking the sidebar button to open the popup.
     */
    function openFavoritesPopup() {
         // Don't open if in preview mode? Or allow opening but disable preview button?
         if (isInPreviewMode) {
            toastr.info("请先退出预览模式。");
            return;
        }

        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) {
            alert("请先打开一个聊天。");
            return;
        }
        const chatId = chatInfo.chatId;
        currentPopupChatId = chatId; // Track which chat we opened it for
        currentPopupPage = 1; // Reset to first page

        if (!favoritesPopup) {
            // Create popup instance only once
             const popupHtml = `
                <div class="favorites-popup-content">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                       <h4 id="favorites-popup-title">Favorites</h4>
                       ${previewButtonHtml} <!-- Add the preview button here -->
                    </div>
                    <hr>
                    <div id="${popupListContainerId}" class="fav-list-container">
                        <div class="empty-state">Loading...</div>
                    </div>
                    <div id="${popupPaginationId}" class="pagination-controls" style="display: none;">
                        <button id="fav-popup-prev" class="menu_button fa-solid fa-arrow-left" title="Previous Page"></button>
                        <span id="fav-popup-page-indicator">Page 1 / 1</span>
                        <button id="fav-popup-next" class="menu_button fa-solid fa-arrow-right" title="Next Page"></button>
                    </div>
                    <hr>
                    <div class="popup_buttons">
                       <button id="fav-popup-clear-invalid" class="menu_button">Clear Invalid</button>
                       <button id="fav-popup-close" class="menu_button">Close</button>
                    </div>
                </div>
            `;
            favoritesPopup = new Popup(popupHtml, 'text', '', { okButton: 'none', cancelButton: 'none', wide: true, large: true });

             // Setup event delegation for popup content (attach to the popup's persistent element)
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-pencil`, handleEditNote);
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-trash`, handleDeleteFavoriteFromPopup);
             $(favoritesPopup.dom).on('click', `#${previewButtonId}`, handlePreviewClick); // Add handler for preview
             $(favoritesPopup.dom).on('click', '#fav-popup-prev', () => handlePopupPagination('prev'));
             $(favoritesPopup.dom).on('click', '#fav-popup-next', () => handlePopupPagination('next'));
             $(favoritesPopup.dom).on('click', '#fav-popup-clear-invalid', handleClearInvalidFavorites);
             $(favoritesPopup.dom).on('click', '#fav-popup-close', () => favoritesPopup.hide());

        }

        updateFavoritesPopup(chatId, currentPopupPage); // Populate content
        favoritesPopup.show();
    }

     /**
     * Renders the content of the favorites popup.
     * @param {string} chatId The chat ID to display favorites for.
     * @param {number} page The page number to display.
     */
    function updateFavoritesPopup(chatId, page = 1) {
        if (!favoritesPopup) return;

        currentPopupChatId = chatId; // Update tracked chat ID
        currentPopupPage = page;
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        const isCurrentChat = getCurrentChatId() === chatId; // Is the popup for the ACTIVE chat?

        let title = "Favorites";
        let favItems = [];
        let totalItems = 0;
        let currentChatMessages = null; // Store messages only if it's the current chat

        if (isCurrentChat) {
            try {
                currentChatMessages = getContext().chat; // Get messages from current context
            } catch (e) { console.error(logPrefix, "Failed to get current chat messages for preview check:", e); }
        }

        if (chatData) {
            title = `Favorites for: ${chatData.name || `Chat ${chatId}`} (${chatData.count || 0})`;
            // Sort by timestamp ascending (oldest first)
            favItems = [...(chatData.items || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            totalItems = chatData.count || 0;
        } else {
            title = `Favorites for: Chat ${chatId} (0)`;
        }

        const $popupContent = $(favoritesPopup.dom).find('.favorites-popup-content');
        $popupContent.find('#favorites-popup-title').text(title);

        const $listContainer = $popupContent.find(`#${popupListContainerId}`);
        const $paginationControls = $popupContent.find(`#${popupPaginationId}`);
        const $pageIndicator = $popupContent.find('#fav-popup-page-indicator');
        const $prevButton = $popupContent.find('#fav-popup-prev');
        const $nextButton = $popupContent.find('#fav-popup-next');
        const $clearInvalidButton = $popupContent.find('#fav-popup-clear-invalid');
        const $previewButton = $popupContent.find(`#${previewButtonId}`); // Get preview button

        if (totalItems === 0) {
            $listContainer.html('<div class="empty-state">此聊天中还没有收藏。</div>');
            $paginationControls.hide();
            $clearInvalidButton.prop('disabled', true);
            $previewButton.prop('disabled', true); // Disable preview if no favorites
            return;
        } else {
             $previewButton.prop('disabled', false); // Enable preview if favorites exist
        }


        const totalPages = Math.ceil(totalItems / itemsPerPagePopup);
        page = Math.max(1, Math.min(page, totalPages)); // Clamp page number
        currentPopupPage = page; // Update global state

        const startIndex = (page - 1) * itemsPerPagePopup;
        const endIndex = startIndex + itemsPerPagePopup;
        const itemsToShow = favItems.slice(startIndex, endIndex);

        let listHtml = '';
        itemsToShow.forEach(favItem => {
            listHtml += renderFavoriteItem(favItem, isCurrentChat, currentChatMessages); // Pass messages for preview
        });

        $listContainer.html(listHtml);

        // Update and show pagination
        $pageIndicator.text(`Page ${page} / ${totalPages}`);
        $prevButton.prop('disabled', page === 1);
        $nextButton.prop('disabled', page === totalPages);
        $paginationControls.show();

        // Enable/disable clear invalid button
        $clearInvalidButton.prop('disabled', !isCurrentChat);
        if (!isCurrentChat) {
             $clearInvalidButton.attr('title', '切换到此聊天以清除无效收藏。');
        } else {
             $clearInvalidButton.removeAttr('title');
        }

        // Scroll list to top after update
        $listContainer.scrollTop(0);
    }

    /**
     * Generates HTML for a single favorite item in the popup list.
     * @param {object} favItem The favorite item object from settings.
     * @param {boolean} isCurrentChat Whether the popup is for the currently active chat.
     * @param {Array<object>|null} currentChatMessages The message array if isCurrentChat is true.
     * @returns {string} HTML string for the list item.
     */
    function renderFavoriteItem(favItem, isCurrentChat, currentChatMessages) {
        let previewText = '';
        let previewClass = 'preview-unavailable'; // Default class
        let message = null;

        // Only attempt to get message preview if it's the currently active chat
        if (isCurrentChat && currentChatMessages) {
            message = getChatMessageById(currentChatMessages, favItem.messageId);
            if (message) {
                previewText = (message.mes || '').substring(0, 80);
                if (message.mes && message.mes.length > 80) previewText += '...';
                previewText = $('<div>').text(previewText).html(); // Basic HTML entity escaping
                previewClass = 'preview-available';
            } else {
                previewText = "[消息已删除]";
                previewClass = 'preview-deleted';
            }
        } else if (!isCurrentChat) {
             previewText = "[预览需要切换到此聊天]";
             previewClass = 'preview-requires-switch';
        } else {
             previewText = "[无法加载预览]"; // Fallback if messages couldn't be loaded
        }


        const formattedTimestamp = favItem.timestamp ? timestampToMoment(favItem.timestamp * 1000).format("YYYY-MM-DD HH:mm:ss") : 'N/A';
        const noteDisplay = favItem.note ? `<div class="fav-note">笔记: ${$('<div>').text(favItem.note).html()}</div>` : ''; // Escape note

        return `
            <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
              <div class="fav-meta">${$('<div>').text(favItem.sender).html()} (${favItem.role}) - ${formattedTimestamp}</div>
              ${noteDisplay}
              <div class="fav-preview ${previewClass}">${previewText}</div>
              <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑笔记"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
              </div>
            </div>
        `;
    }

     /** Handles popup pagination clicks */
    function handlePopupPagination(direction) {
        if (!favoritesPopup || !currentPopupChatId) return;

        const settings = getPluginSettings();
        const chatData = settings.chats[currentPopupChatId];
        if (!chatData || !chatData.items) return; // Check items array exists

        const totalItems = chatData.count || 0;
        if (totalItems === 0) return; // No items to paginate

        const totalPages = Math.ceil(totalItems / itemsPerPagePopup);

        if (direction === 'prev' && currentPopupPage > 1) {
            currentPopupPage--;
        } else if (direction === 'next' && currentPopupPage < totalPages) {
            currentPopupPage++;
        }
        updateFavoritesPopup(currentPopupChatId, currentPopupPage);
    }


    /** Handles click on the Edit Note icon in the popup */
    async function handleEditNote(event) {
         // Prevent editing if in preview mode
         if (isInPreviewMode) {
            toastr.warning("无法在预览模式下编辑笔记。");
            return;
        }
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         // Use the chat ID the popup is currently showing
         const chatId = currentPopupChatId;

         if (!chatId || !favId) {
             console.error(logPrefix, "EditNote: Missing chatId or favId.");
             return;
         }

         const settings = getPluginSettings();
         // Ensure the chat exists in settings
         const chatData = settings.chats[chatId];
         if (!chatData || !chatData.items) {
             console.error(logPrefix, `EditNote: Chat data or items not found for chatId ${chatId}.`);
             return;
         }
         const favItem = chatData.items.find(item => item.id === favId);

         if (!favItem) {
             console.error(logPrefix, `Favorite item ${favId} not found for editing note in chat ${chatId}.`);
             alert("错误：找不到要编辑的收藏项。");
             return;
         }

         try {
             const result = await callGenericPopup(
                 `为收藏输入笔记 (发送者: ${favItem.sender}):`,
                 POPUP_TYPE.INPUT,
                 favItem.note || '', // Default value is current note
                 { rows: 3 }
             );

             if (result !== null && result !== undefined && result !== POPUP_RESULT.CANCEL) { // User confirmed (even if empty string)
                 favItem.note = result.trim();
                 console.log(logPrefix, `Updated note for favorite ${favId} in chat ${chatId}.`);
                 saveSettingsDebounced();
                 // Update just this item's display in the popup for efficiency
                 const $noteDisplay = $itemElement.find('.fav-note');
                 const escapedNote = $('<div>').text(favItem.note).html();
                  if (favItem.note) {
                      if ($noteDisplay.length) {
                          $noteDisplay.html(`笔记: ${escapedNote}`).show();
                      } else {
                          // Add note element if it didn't exist
                          $itemElement.find('.fav-meta').after(`<div class="fav-note">笔记: ${escapedNote}</div>`);
                      }
                  } else {
                      // Remove note element if empty
                      $noteDisplay.remove();
                  }

                 // Also update plugin page if visible
                 renderPluginPage();
             }
         } catch (error) {
             console.error(logPrefix, "Error during edit note popup:", error);
              if (error !== POPUP_RESULT.CANCEL) {
                   alert("编辑笔记时发生错误。");
               }
         }
     }

     /** Handles click on the Delete icon in the popup */
     async function handleDeleteFavoriteFromPopup(event) {
        // Prevent deleting if in preview mode
         if (isInPreviewMode) {
            toastr.warning("无法在预览模式下删除收藏。");
            return;
        }
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const messageId = $itemElement.data('msg-id'); // Get message ID for icon update
         const chatId = currentPopupChatId; // Get chat ID from popup state

         if (!chatId || !favId) {
              console.error(logPrefix, "DeleteFav: Missing chatId or favId.");
             return;
         }

         try {
             const confirmation = await callGenericPopup(
                 "确定要移除此收藏条目吗？",
                 POPUP_TYPE.CONFIRM
             );

             if (confirmation === true || confirmation === POPUP_RESULT.AFFIRMATIVE) { // Check confirmation result explicitly
                 const removed = removeFavoriteById(chatId, favId); // This handles saving and potentially popup refresh
                 if (removed) {
                     toastr.success("收藏已移除。"); // Give feedback
                     // Update the icon in the main chat interface ONLY if the popup was for the currently active chat
                     if (getCurrentChatId() === chatId) {
                         const $messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                         if ($messageElement.length) {
                             updateFavoriteIconState($messageElement, false); // Set to unfavorited
                         }
                     }
                     // updateFavoritesPopup is called within removeFavoriteById, ensures list is fresh
                 } else {
                     // This case should be rare if the button exists, but handle it.
                     alert("错误：无法移除收藏。可能已被删除。");
                     // Optionally refresh popup again to ensure consistency
                     updateFavoritesPopup(chatId, currentPopupPage);
                 }
             }
         } catch (error) {
             console.error(logPrefix, "Error during delete confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) { // Don't show alert if user just cancelled
                 alert("尝试删除收藏时发生错误。");
             }
         }
     }

     /** Handles click on the 'Clear Invalid' button in the popup */
    async function handleClearInvalidFavorites() {
        // Prevent clearing if in preview mode
         if (isInPreviewMode) {
            toastr.warning("无法在预览模式下清除无效收藏。");
            return;
        }
        const chatId = currentPopupChatId;
        // Ensure the popup is open for the *currently active* chat
        if (!chatId || getCurrentChatId() !== chatId) {
            alert("请确保您在正确的聊天中，才能清除该聊天的无效收藏。");
            return;
        }

        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items || chatData.items.length === 0) {
            alert("此聊天中没有收藏可供检查。");
            return;
        }

        // Get current messages from the active context
        const context = getContext();
        const currentMessageIds = new Set(context.chat.map(msg => String(msg.id)));
        const invalidFavIds = [];

        chatData.items.forEach(favItem => {
            if (!currentMessageIds.has(String(favItem.messageId))) {
                invalidFavIds.push(favItem.id);
            }
        });

        if (invalidFavIds.length === 0) {
            alert("未找到无效的收藏（所有对应的消息仍然存在）。");
            return;
        }

        try {
            const confirmation = await callGenericPopup(
                `找到 ${invalidFavIds.length} 个指向已删除消息的收藏。要移除它们吗？`,
                POPUP_TYPE.CONFIRM
            );

            if (confirmation === true || confirmation === POPUP_RESULT.AFFIRMATIVE) {
                let removedCount = 0;
                invalidFavIds.forEach(favId => {
                    // Use removeFavoriteById which handles count updates and saving
                    if (removeFavoriteById(chatId, favId)) {
                        removedCount++;
                    }
                });
                console.log(logPrefix, `Cleared ${removedCount} invalid favorites from chat ${chatId}.`);
                if (removedCount > 0) {
                    alert(`移除了 ${removedCount} 个无效的收藏条目。`);
                    // The popup list is updated inside removeFavoriteById calls.
                    // Explicitly call update at the end *might* be needed if removeFavoriteById's update is debounced or async in a way that doesn't guarantee immediate reflection for batch operations. Let's rely on its internal update for now.
                    // updateFavoritesPopup(chatId, currentPopupPage); // Potentially redundant, but safe
                } else {
                     alert("没有无效收藏被移除（操作可能失败）。");
                }
            }
        } catch (error) {
             console.error(logPrefix, "Error during clear invalid confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) {
                 alert("尝试清除无效收藏时发生错误。");
             }
        }
    }

    /**
     * Handles clicking the Preview button in the popup.
     */
    async function handlePreviewClick() {
        console.log(logPrefix, "Preview button clicked.");
        // 1. Get Info from the Original Chat Context (where the popup is open)
        const originalChatId = currentPopupChatId; // The chat ID the popup is displaying
        if (!originalChatId) {
            console.error(logPrefix, "Preview failed: Cannot determine the original chat ID from popup state.");
            alert("错误：无法确定原始聊天以进行预览。");
            return;
        }

        // Store original context details BEFORE switching or creating
        originalContextBeforePreview = getCurrentChatInfo(); // Use our enhanced function
        if (!originalContextBeforePreview || originalContextBeforePreview.chatId !== originalChatId) {
             console.error(logPrefix, "Preview failed: Could not get consistent original chat context.");
             // Try to refetch based on popup's chat ID? Risky. Better to abort.
             alert("错误：无法获取原始聊天上下文信息。");
             originalContextBeforePreview = null; // Clear potentially inconsistent data
             return;
        }

        const { type: originalType, characterId: originalCharacterId, groupId: originalGroupId, chatMessages: originalChatMessages } = originalContextBeforePreview;

        // Check if generation is in progress in the original context
        if (originalType === 'group' && is_group_generating) {
            toastr.warning("群组正在生成回复，请稍后再试预览。"); return;
        }
        if (originalType === 'private' && is_send_press) {
            toastr.warning("角色正在生成回复，请稍后再试预览。"); return;
        }
        // Maybe check isChatSaving globally?
        if (isChatSaving) {
             toastr.warning("聊天正在保存，请稍后再试预览。"); return;
        }


        // 2. Get Favorite Items and Find Full Messages
        const settings = getPluginSettings();
        const chatData = settings.chats[originalChatId];
        if (!chatData || !chatData.items || chatData.items.length === 0) {
            alert("此聊天中没有收藏可供预览。");
            return;
        }
        const favoriteItems = chatData.items;
        const fullMessagesToPreview = findFullMessagesForPreview(originalChatMessages, favoriteItems);

        if (fullMessagesToPreview.length === 0) {
             alert("未找到有效的收藏消息进行预览（可能所有原始消息都已被删除）。");
             return;
        }

        // Close the popup before switching chat
        if (favoritesPopup) favoritesPopup.hide();

        // 3. Determine Target Preview Chat ID (Create or Get Existing)
        let targetPreviewChatId = getPreviewChatId(originalChatId);
        let newChatCreated = false;

        try {
            if (!targetPreviewChatId) {
                console.log(logPrefix, `No existing preview chat found for ${originalChatId}. Creating new one...`);
                // Create new chat - doNewChat switches context automatically
                await doNewChat({ deleteCurrentChat: false });
                newChatCreated = true;

                // Get the new context *immediately* after creation
                const newContext = getContext();
                targetPreviewChatId = newContext.chatId; // Get the ID of the newly created chat

                if (!targetPreviewChatId) {
                    throw new Error("Failed to get chatId after creating new chat.");
                }

                console.log(logPrefix, `New preview chat created with ID: ${targetPreviewChatId}`);

                // Rename the new chat (must be done within the new context)
                await renameChat(previewChatName); // renameChat should work on the current context
                console.log(logPrefix, `Renamed preview chat to "${previewChatName}"`);

                // Store the mapping
                storePreviewChatId(originalChatId, targetPreviewChatId);

            } else {
                console.log(logPrefix, `Found existing preview chat ID: ${targetPreviewChatId} for ${originalChatId}. Switching...`);
                // Switch to existing preview chat
                if (originalType === 'group') {
                    await openGroupChat(originalGroupId, targetPreviewChatId); // Assuming openGroupChat takes target chat ID
                } else { // Private chat
                    await openCharacterChat(originalCharacterId, targetPreviewChatId); // Assuming openCharacterChat takes target chat ID
                }
                 // Add a small delay to allow context switching to settle
                 await new Promise(resolve => setTimeout(resolve, 200));
            }

            // 4. Verify Context Switch and Populate
             // We should now be in the preview chat context
             const previewContext = getContext();
             if (previewContext.chatId !== targetPreviewChatId) {
                 console.error(logPrefix, `Context switch failed! Expected ${targetPreviewChatId}, but current is ${previewContext.chatId}`);
                 alert("错误：切换到预览聊天失败。");
                 // Try to switch back? Or leave user in limbo? Switching back is safer.
                 if (originalType === 'group') {
                     await openGroupChat(originalGroupId, originalChatId);
                 } else {
                     await openCharacterChat(originalCharacterId, originalChatId);
                 }
                 return;
             }

            console.log(logPrefix, `Successfully switched to preview chat: ${targetPreviewChatId}`);
            isInPreviewMode = true; // Set flag AFTER successful switch

            // 5. Disable Interaction & Populate
            toggleChatInteraction(true); // Disable input, buttons etc.
            await populatePreviewChat(fullMessagesToPreview); // Clear and fill

        } catch (error) {
            console.error(logPrefix, "Error during preview chat creation or switching:", error);
            alert(`创建或切换到预览聊天时出错: ${error.message}`);
            isInPreviewMode = false; // Ensure flag is reset on error
            toggleChatInteraction(false); // Ensure UI is re-enabled on error
            // Attempt to switch back to original chat if something went wrong after creation/switch attempt
            if (originalContextBeforePreview && getCurrentChatId() !== originalContextBeforePreview.chatId) {
                try {
                    console.log(logPrefix, "Attempting to switch back to original chat after error...");
                     if (originalType === 'group') {
                         await openGroupChat(originalGroupId, originalChatId);
                     } else {
                         await openCharacterChat(originalCharacterId, originalChatId);
                     }
                } catch (switchBackError) {
                     console.error(logPrefix, "Failed to switch back to original chat:", switchBackError);
                     alert("切换回原始聊天失败。请手动切换。");
                }
            }
            originalContextBeforePreview = null; // Clear stored context
        }
    }

    // --- Plugin Page (Settings Overview) Functions ---
    // ... (Keep existing renderPluginPage, handlePluginPagePagination, handlePluginPageChatClick, setupPluginPageEventDelegation) ...
     /** Renders the plugin's settings page content (overview of all favorites). */
    function renderPluginPage(page = 1) {
        const $settingsArea = $(`#${settingsContainerId}`);
        if (!$settingsArea.length) return; // Container not injected yet

        const settings = getPluginSettings();
        const allChats = settings.chats || {};
        const chatIds = Object.keys(allChats);
        // Also get preview mapping to potentially link/show info
        const previewMap = settings[previewChatMappingKey] || {};

        if (chatIds.length === 0) {
            $settingsArea.html('<div class="empty-state">在所有聊天中都未找到收藏。</div>');
            return;
        }

        // Group chats by character/group name for display
        const groupedChats = {};
        const context = getContext(); // Get context to try and find current names

        chatIds.forEach(chatId => {
            const chatData = allChats[chatId];
            // Skip if chatData is somehow invalid or missing name/type (shouldn't happen often)
            if (!chatData || !chatData.type) return;

            let groupKey = "未知 / 其他";
            let displayName = chatData.name || `Chat ${chatId}`; // Use stored name first
            let entityId = null; // Store ID for potential actions

            if (chatData.type === "private" && chatData.characterId !== undefined) {
                entityId = chatData.characterId;
                // Try to get the current character name from context for display
                const character = context.characters?.find(c => c.id === chatData.characterId);
                displayName = character ? character.name : displayName; // Use current char name if found
                groupKey = displayName; // Group by character name
            } else if (chatData.type === "group" && chatData.groupId !== undefined) {
                entityId = chatData.groupId;
                 // Try to get the current group name from context
                const group = context.groups?.find(g => g.id === chatData.groupId);
                displayName = group ? group.name : displayName; // Use current group name if found
                groupKey = displayName; // Group by group name
            }

            if (!groupedChats[groupKey]) {
                groupedChats[groupKey] = [];
            }
            groupedChats[groupKey].push({
                chatId: chatId,
                displayName: displayName,
                count: chatData.count || 0,
                entityId: entityId, // Pass the ID along
                type: chatData.type,
                hasPreview: !!previewMap[chatId], // Check if a preview chat exists
            });
        });

        // Sort groups alphabetically, then chats within groups by name
        const sortedGroupKeys = Object.keys(groupedChats).sort((a, b) => a.localeCompare(b));

        let allEntries = [];
        sortedGroupKeys.forEach(groupKey => {
             // Add group title marker
             allEntries.push({ isGroupTitle: true, title: groupKey });
            const sortedChats = groupedChats[groupKey].sort((a, b) => a.displayName.localeCompare(b.displayName));
             allEntries = allEntries.concat(sortedChats);
        });


        const totalEntries = allEntries.length; // Includes titles
        const totalPages = Math.ceil(totalEntries / itemsPerPagePluginPage);
        page = Math.max(1, Math.min(page, totalPages));
        currentPluginPagePage = page;

        const startIndex = (page - 1) * itemsPerPagePluginPage;
        const endIndex = startIndex + itemsPerPagePluginPage;
        const entriesToShow = allEntries.slice(startIndex, endIndex);

        let contentHtml = `<div id="${pluginPageListContainerId}" class="chat-list-container">`;
        entriesToShow.forEach(entry => {
            if (entry.isGroupTitle) {
                contentHtml += `<div class="chat-group-title">${$('<div>').text(entry.title).html()}</div>`;
            } else {
                // Add preview indicator if available
                 const previewIndicator = entry.hasPreview ? ' <i class="fa-solid fa-eye fa-xs" title="存在预览聊天"></i>' : '';
                contentHtml += `
                    <div class="chat-entry-item" data-chat-id="${entry.chatId}" title="点击查看 ${$('<div>').text(entry.displayName).html()} 的收藏">
                        <span>${$('<div>').text(entry.displayName).html()}${previewIndicator}</span>
                        <span class="count">(${entry.count})</span>
                    </div>`;
            }
        });
        contentHtml += `</div>`; // Close list container

        // Add pagination
        if (totalPages > 1) {
            contentHtml += `
                <div id="${pluginPagePaginationId}" class="pagination-controls">
                    <button id="fav-plugin-prev" class="menu_button fa-solid fa-arrow-left" title="上一页" ${page === 1 ? 'disabled' : ''}></button>
                    <span id="fav-plugin-page-indicator">Page ${page} / ${totalPages}</span>
                    <button id="fav-plugin-next" class="menu_button fa-solid fa-arrow-right" title="下一页" ${page === totalPages ? 'disabled' : ''}></button>
                </div>`;
        }

        $settingsArea.html(contentHtml);
         // Ensure event delegation is active for the newly rendered content
        setupPluginPageEventDelegation(); // Re-run setup after render
    }

     /** Handles plugin page pagination clicks */
     function handlePluginPagePagination(direction) {
         const settings = getPluginSettings();
         const allChats = settings.chats || {};
          const chatIds = Object.keys(allChats);
           if(chatIds.length === 0) return; // No items, pagination shouldn't be visible anyway

          // Recalculate total pages based on how renderPluginPage groups/counts entries including titles
          let entryCountForPaging = 0;
          const groupedChats = {};
           chatIds.forEach(chatId => {
                 const chatData = allChats[chatId];
                 if (!chatData || !chatData.type) return; // Skip invalid

                 let groupKey = "未知 / 其他";
                 if (chatData.type === "private" && chatData.characterId !== undefined) {
                      groupKey = chatData.name || `Character ${chatData.characterId}`; // Use stored name or fallback
                 } else if (chatData.type === "group" && chatData.groupId !== undefined) {
                      groupKey = chatData.name || `Group ${chatData.groupId}`;
                 }
                 // Count group title only once
                 if (!groupedChats[groupKey]) {
                     groupedChats[groupKey] = true;
                     entryCountForPaging++; // Count group title
                 }
                 entryCountForPaging++; // Count chat entry itself
             });

         const totalPages = Math.ceil(entryCountForPaging / itemsPerPagePluginPage);

         if (direction === 'prev' && currentPluginPagePage > 1) {
             currentPluginPagePage--;
         } else if (direction === 'next' && currentPluginPagePage < totalPages) {
             currentPluginPagePage++;
         }
         renderPluginPage(currentPluginPagePage);
     }


    /** Handles clicks on chat entries within the plugin settings page */
    function handlePluginPageChatClick(event) {
         // Prevent action if in preview mode
         if (isInPreviewMode) {
            toastr.warning("请先退出预览模式，再查看其他收藏。");
            return;
        }
        const $chatEntry = $(event.target).closest('.chat-entry-item');
        if (!$chatEntry.length) return;

        const clickedChatId = $chatEntry.data('chat-id');
        if (clickedChatId) {
             console.log(logPrefix, `Opening favorites popup for chat ${clickedChatId} from plugin page.`);
            // Open the same popup, but pass the specific chatId
            currentPopupChatId = String(clickedChatId); // Ensure it's a string
            currentPopupPage = 1; // Reset page
             if(!favoritesPopup) {
                  // Need to ensure popup is created correctly, openFavoritesPopup does this,
                  // but it relies on an active chat context which might not be the one clicked.
                  // Best might be to *inform* the user to switch to that chat first,
                  // or make the popup independent of the current active chat (more complex).

                  // Let's try to make the popup work directly:
                 try {
                     openFavoritesPopupForChat(clickedChatId); // A new function to handle this specific case
                 } catch (e) {
                     console.error(logPrefix, "Failed to open popup from plugin page:", e);
                     alert("无法直接打开此聊天的收藏夹。请先切换到该聊天。");
                 }

             } else {
                 // If popup exists, update it for the clicked chat
                updateFavoritesPopup(String(clickedChatId), currentPopupPage);
                favoritesPopup.show();
             }
        }
    }

    /**
     * Variation of openFavoritesPopup specifically for opening from the plugin page,
     * potentially when the target chat is not the active one.
     * NOTE: This might have limitations if 'Clear Invalid' or previews rely heavily
     * on the *active* context matching the popup's chat.
     */
     function openFavoritesPopupForChat(chatId) {
          // Set the state correctly
        currentPopupChatId = chatId;
        currentPopupPage = 1;

         if (!favoritesPopup) {
            // Create popup instance (same structure as before)
             const popupHtml = `...`; // Same HTML as in openFavoritesPopup
             favoritesPopup = new Popup(/*...*/);
             // Setup event delegation (same as before)
              $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-pencil`, handleEditNote);
              // ... other handlers ...
              $(favoritesPopup.dom).on('click', `#${previewButtonId}`, handlePreviewClick); // Add handler for preview
         }

         // Update content for the specific chat ID
        updateFavoritesPopup(chatId, currentPopupPage);
        favoritesPopup.show();
     }


    /** Sets up event delegation for the plugin page list and pagination */
    function setupPluginPageEventDelegation() {
        const $settingsArea = $(`#${settingsContainerId}`);
        // Remove previous handlers to avoid duplicates if called multiple times
        $settingsArea.off('click', '.chat-entry-item');
        $settingsArea.off('click', '#fav-plugin-prev');
        $settingsArea.off('click', '#fav-plugin-next');

        // Add delegation
        $settingsArea.on('click', '.chat-entry-item', handlePluginPageChatClick);
        $settingsArea.on('click', '#fav-plugin-prev', () => handlePluginPagePagination('prev'));
        $settingsArea.on('click', '#fav-plugin-next', () => handlePluginPagePagination('next'));
    }



        // --- Plugin Initialization ---
    jQuery(async () => {
        console.log(logPrefix, "Loading...");
        initializeSettings();

        // 1. Inject into Extensions Page (Plugin Overview)
        try {
            // *** 使用正确的模板路径 (相对于 public 目录) ***
            // 假设 star2 是你的插件文件夹名
            const settingsHtml = await renderExtensionTemplateAsync(`extensions/third-party/${pluginFolderName}/settings_display.html`, 'settings_display');
            let $container = $('#extensions_settings');
             if (!$container.length) {
                $container = $('#translation_container');
                 console.warn(logPrefix, "Using #translation_container as fallback for settings UI.");
             }

             if ($container.length) {
                 $container.append(settingsHtml);
                 console.log(logPrefix, `Appended settings description template to ${$container.attr('id')}`);
                 const $drawerContent = $container.find('.inline-drawer-content').last();
                 if ($drawerContent.length) {
                     $drawerContent.append(`<hr><h4 style="margin-top: 15px;">所有收藏的聊天:</h4><div id="${settingsContainerId}">Loading...</div>`);
                     console.log(logPrefix, `Appended favorites list container (#${settingsContainerId}) inside the drawer content.`);
                     renderPluginPage(currentPluginPagePage);
                     setupPluginPageEventDelegation();
                 } else {
                     console.error(logPrefix, `Could not find '.inline-drawer-content' to inject the favorites list.`);
                     toastr.error("无法注入收藏列表界面。");
                 }
             } else {
                 console.error(logPrefix, "Could not find container (#extensions_settings or #translation_container) for settings UI.");
             }
        } catch (error) {
            console.error(logPrefix, "Failed to load or inject settings_display.html:", error);
            toastr.error("无法加载插件设置界面。");
        }

        // 2. *** REMOVED Sidebar Button Injection ***

        // 3. *** ADD Input Button Injection ***
        try {
            // *** 使用正确的模板路径 (相对于 public 目录) ***
            // 假设 input_button.html 在 public/extensions/third-party/star2/ 目录下
             const inputButtonHtml = await renderExtensionTemplateAsync(`extensions/third-party/${pluginFolderName}/input_button.html`, 'input_button');

             // *** 选择合适的注入目标 - 需要根据 SillyTavern 的实际 DOM 结构调整 ***
             // 尝试一些常见的输入区域容器 ID 或类名
             let $buttonTargetContainer = $('#chat_controls'); // 常见容器
             if (!$buttonTargetContainer.length) {
                 $buttonTargetContainer = $('#input_buttons_wrapper'); // 另一个可能的容器
             }
             if (!$buttonTargetContainer.length) {
                  // 尝试添加到发送按钮的父容器
                 $buttonTargetContainer = $('#send_button').parent();
             }
             // 可能需要更具体的选择器，例如 $('#send_form .buttons-wrapper')

             if ($buttonTargetContainer.length) {
                 // prepend 可能比 append 效果更好，放在按钮组前面
                 $buttonTargetContainer.prepend(inputButtonHtml);
                 console.log(logPrefix, `Added input button (#favorites_button) to ${$buttonTargetContainer.prop("tagName")}#${$buttonTargetContainer.attr("id") || '[no id]'}`);
                 // *** 绑定点击事件到新的按钮 ID ***
                 $(document).off('click', '#favorites_button').on('click', '#favorites_button', openFavoritesPopup);
             } else {
                 console.error(logPrefix, "Could not find a suitable container near the chat input for the favorites button.");
                 toastr.error("无法找到收藏按钮的注入位置。");
             }
        } catch (error) {
            console.error(logPrefix, "Failed to load or inject input_button.html:", error);
             toastr.error("无法加载收藏输入按钮。");
        }


        // 4. Setup Message Button Injection & Event Delegation (Keep previous fix)
        // injectOrUpdateFavoriteIcons(); // Commented out direct call
        $(document).off('click', favIconSelector).on('click', favIconSelector, handleFavoriteToggle);
        console.log(logPrefix, `Set up event delegation for ${favIconSelector}`);


        // 5. Listen for SillyTavern events (Keep as is)
        // ... (event listeners remain the same) ...
         eventSource.on(event_types.CHAT_UPDATED, () => { if (!isInPreviewMode) injectOrUpdateFavoriteIcons(); });
         eventSource.on(event_types.MESSAGE_SENT, () => { if (!isInPreviewMode) injectOrUpdateFavoriteIcons(); });
         eventSource.on(event_types.MESSAGE_RECEIVED, () => { if (!isInPreviewMode) injectOrUpdateFavoriteIcons(); });
         eventSource.on(event_types.MORE_MESSAGES_LOADED, () => { if (!isInPreviewMode) injectOrUpdateFavoriteIcons(); });
         eventSource.on(event_types.CHAT_CHANGED, (newChatId) => {
             if (isInPreviewMode) { /* ... preview exit logic ... */ }
             // ... (rest of CHAT_CHANGED logic) ...
              if (isInPreviewMode) {
                 console.log(logPrefix, `Chat changed to ${newChatId} while in preview mode. Exiting preview...`);
                 toggleChatInteraction(false);
                 isInPreviewMode = false;
                 originalContextBeforePreview = null;
             }
             const settings = getPluginSettings();
             const previewMap = settings[previewChatMappingKey] || {};
             const isNewChatAPreview = Object.values(previewMap).includes(newChatId);
             if (!isNewChatAPreview) {
                 injectOrUpdateFavoriteIcons();
             } else if (!isInPreviewMode) {
                 console.warn(logPrefix, `Landed in a preview chat (${newChatId}) but not in preview mode. Correcting state.`);
                 toggleChatInteraction(true);
                 isInPreviewMode = true;
             }
             if ($(`#${settingsContainerId}`).is(':visible')) { renderPluginPage(currentPluginPagePage); }
         });

        // 6. Schedule initial icon update with delay (Keep previous fix)
        setTimeout(() => {
            console.log(logPrefix, "Running delayed initial icon injection.");
            injectOrUpdateFavoriteIcons();
        }, 500); // Delay 500ms

        console.log(logPrefix, "Loaded successfully (corrected button logic).");
    });

    // ... (rest of the code remains the same, including the injectOrUpdateFavoriteIcons with debugging logs) ...

})(); // End IIFE
