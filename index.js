// public/extensions/third-party/star2/index.js // <- 修改了路径注释

// Import from the core script (public/script.js)
import {
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    // messageFormatting, // Not strictly needed for basic preview, but could be used
    chat, // Import chat array for direct access if needed (or use context.chat)
    doNewChat,
    clearChat,
    renameChat,
    openCharacterChat,
    is_send_press,
    isChatSaving,
    this_chid, // Needed for context checks maybe? getCurrentChatInfo is better
    addOneMessage, // Explicitly import addOneMessage
    saveChatConditional, // Import for potentially saving the preview chat structure/name? (Less likely needed)
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

// Import from i18n (as requested)
import { t } from '../../../i18n.js';

import { power_user } from '../../../power-user.js';

// Import from group chats (as needed for checks)
import {
    selected_group,
    openGroupChat,
    is_group_generating
} from '../../../group-chats.js';


// jQuery ($) is globally available

(function () { // Use IIFE to encapsulate plugin logic

    const pluginName = 'star2'; // <--- 修改插件名称
    const pluginFolderName = 'star2'; // <--- 修改文件夹名称
    const logPrefix = `[${pluginName}]`;

    // --- Constants ---
    const favIconClass = 'favorite-toggle-icon';
    const favIconSelector = `.${favIconClass}`;
    const favoritedIconClass = 'fa-solid fa-star'; // Gold, solid star
    const unfavoritedIconClass = 'fa-regular fa-star'; // Hollow star
    const settingsContainerId = 'favorites-plugin-settings-area'; // Keep using a unique ID if needed
    // const sidebarButtonId = 'my_favorites_sidebar_button'; // Keep using a unique ID if needed for input button
    const sidebarButtonId = 'favorites_button'; // Use ID from input_button.html
    const popupListContainerId = 'favorites-popup-list-container';
    const popupPaginationId = 'favorites-popup-pagination';
    const pluginPageListContainerId = 'favorites-plugin-page-list';
    const pluginPagePaginationId = 'favorites-plugin-page-pagination';
    const previewChatName = '<预览聊天>'; // Name for the preview chat
    const itemsPerPagePopup = 10;
    const itemsPerPagePluginPage = 20;


    // --- HTML Snippets ---
    const messageButtonHtml = `
        <div class="mes_button ${favIconClass}" title="${t('Favorite/Unfavorite Message')}">
            <i class="${unfavoritedIconClass}"></i>
        </div>
    `;

    // --- Global State ---
    let favoritesPopup = null; // Stores the Popup instance
    let currentPopupOriginalChatInfo = null; // Tracks WHICH chat the popup was opened for (needed for preview)
    let currentPopupPage = 1;
    let currentPluginPagePage = 1;

    // --- Core Data Functions ---

    /**
     * Ensures the plugin's settings object exists, including preview chat map.
     */
    function initializeSettings() {
        if (!extension_settings[pluginName]) {
            extension_settings[pluginName] = {
                chats: {},
                previewChats: {} // <-- Add mapping for preview chats
            };
            console.log(logPrefix, 'Initialized settings.');
        }
        // Ensure sub-objects exist
        if (!extension_settings[pluginName].chats) {
            extension_settings[pluginName].chats = {};
        }
        if (!extension_settings[pluginName].previewChats) {
            extension_settings[pluginName].previewChats = {};
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
     * Gets chat info for the current context. Crucial for knowing type, IDs, and filenames.
     * @returns {object|null} { chatId, type, name, characterId?, groupId?, chatFileName? } or null.
     *                      chatId: The ID used in settings (usually filename for characters, group ID for groups?) -> Let's use getCurrentChatId() result consistently.
     *                      type: "private" or "group".
     *                      name: Character or Group name.
     *                      characterId: Numeric character ID if private.
     *                      groupId: Group ID string if group.
     *                      chatFileName: The actual filename (e.g., Bob_12345.jsonl) needed for openCharacterChat.
     */
     function getCurrentChatInfo() {
        try {
            const context = getContext();
            const currentChatId = getCurrentChatId(); // This IS the filename for characters, or group chat ID? Let's test. It seems to be chat file name for chars.
            if (!currentChatId) return null;

            let type, name, characterId, groupId, chatFileName;

            if (context.groupId) { // Check group first
                type = "group";
                groupId = context.groupId;
                const group = context.groups ? context.groups.find(g => g.id === groupId) : null;
                name = group ? group.name : `Group ${groupId}`;
                chatFileName = currentChatId; // For groups, currentChatId might be the specific chat file ID within the group
            } else if (context.characterId !== undefined && context.characterId !== null) { // Check character
                type = "private";
                characterId = context.characterId; // Numeric ID
                name = context.name2; // Character name from context
                chatFileName = currentChatId; // The actual .jsonl filename
                // groupId = undefined;
            } else {
                console.warn(logPrefix, "Could not determine chat type for ID:", currentChatId);
                return null; // Neither group nor character context recognized
            }

            // Let's use chatFileName as the primary key for OUR settings map, as it's unique per chat file.
            // For groups, multiple chat files can exist. We need to ensure consistency.
            // Maybe use `context.groupId` as the key for groups? Let's stick to `currentChatId` which is the active chat file id.
            return { chatId: currentChatId, type, name, characterId, groupId, chatFileName };
        } catch (error) {
            console.error(logPrefix, "Error getting current chat info:", error);
            return null;
        }
    }


     /**
     * Gets a specific chat message object from the current context's chat array.
     * Adheres to original script's likely method.
     * @param {string|number} messageId The ID of the message to find.
     * @returns {object|null} The message object or null if not found.
     */
     function getChatMessageById(messageId) {
        try {
            // Use the imported global `chat` array which script.js manages
            // Ensure messageId is parsed correctly if it's sometimes a string/number
            const targetId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
            // Find message by its original index 'id' which corresponds to its position in the array.
            if (targetId >= 0 && targetId < chat.length) {
                return chat[targetId];
            }
            // Fallback: maybe id is stored differently? Check context too.
             const context = getContext();
             return context.chat?.find(msg => msg.id === targetId) || null; // Less likely needed if global `chat` is reliable
        } catch (error) {
            console.warn(logPrefix, `Could not get message ${messageId} from context chat:`, error);
            return null;
        }
    }


    /**
     * Checks if a message is currently favorited.
     * @param {string} chatId The chat ID (key in settings.chats).
     * @param {string|number} messageId The message ID.
     * @returns {boolean} True if favorited, false otherwise.
     */
    function isFavorited(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items) return false;
        const stringMessageId = String(messageId);
        return chatData.items.some(item => String(item.messageId) === stringMessageId);
    }

    /**
     * Adds a message to favorites.
     * @param {object} chatInfo - Result from getCurrentChatInfo().
     * @param {object} message - The message object from context.chat.
     */
    function addFavorite(chatInfo, message) {
        if (!chatInfo || !message || message.id === undefined) { // Ensure message has an id
            console.error(logPrefix, "addFavorite: Missing chatInfo or message object/id.", { chatInfo, message });
            return;
        }
        const { chatId, type, name, characterId, groupId } = chatInfo; // Use chatId from chatInfo as the key
        const settings = getPluginSettings();

        // Ensure chat entry exists
        if (!settings.chats[chatId]) {
            settings.chats[chatId] = {
                type: type,
                name: name, // Store name at time of first favorite
                characterId: characterId,
                groupId: groupId,
                count: 0,
                items: [],
            };
        } else {
            // Keep name/type potentially updated if needed, or just ensure structure
             settings.chats[chatId].name = name; // Update name in case it changed
             settings.chats[chatId].type = type;
             if (characterId !== undefined) settings.chats[chatId].characterId = characterId;
             if (groupId !== undefined) settings.chats[chatId].groupId = groupId;
             if (!settings.chats[chatId].items) settings.chats[chatId].items = [];
             if (typeof settings.chats[chatId].count !== 'number') settings.chats[chatId].count = 0;
        }

        // Use message.id (original index) as messageId
        const messageId = message.id;

        // Check if already favorited
        if (isFavorited(chatId, messageId)) {
            console.warn(logPrefix, `Message ${messageId} in chat ${chatId} is already favorited.`);
            return;
        }

        const newItem = {
            id: uuidv4(), // Unique favorite ID
            messageId: String(messageId), // Store original message index as string
            sender: message.name,
            role: message.is_user ? "user" : (message.is_system ? "system" : "character"),
            timestamp: message.send_date || Date.now(), // Use send_date, fallback to now
            note: "", // Initialize note as empty
        };

        settings.chats[chatId].items.push(newItem);
        settings.chats[chatId].count = settings.chats[chatId].items.length;

        console.log(logPrefix, `Favorited message ${messageId} in chat ${chatId}. New count: ${settings.chats[chatId].count}`);
        saveSettingsDebounced();

        // Update popup if it's open for this chat
        if (favoritesPopup && favoritesPopup.isShown() && currentPopupOriginalChatInfo?.chatId === chatId) {
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

            // If chat becomes empty, remove the chat entry itself (optional, maybe keep for preview association?)
            // Let's keep the chat entry even if empty for now, in case a preview chat is associated.
            // if (chatData.count === 0 && !getPluginSettings().previewChats[chatId]) { // Only delete if no preview associated
            //     delete settings.chats[chatId];
            //     console.log(logPrefix, `Removed empty chat entry for ${chatId}.`);
            // }
            saveSettingsDebounced();

            // Update popup if it's open for this chat
            if (favoritesPopup && favoritesPopup.isShown() && currentPopupOriginalChatInfo?.chatId === chatId) {
                 const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);
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
     * Removes a favorite based on the original message ID (index).
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The original message ID (index).
     * @returns {boolean} True if removal was successful, false otherwise.
     */
     function removeFavoriteByMessageId(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            return false; // Not necessarily an error if toggling an unfavorited message
        }

        const stringMessageId = String(messageId);
        const favItem = chatData.items.find(item => String(item.messageId) === stringMessageId);

        if (favItem) {
            return removeFavoriteById(chatId, favItem.id);
        } else {
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
            const title = isFav ? t('Unfavorite Message') : t('Favorite Message');
            if (isFav) {
                $icon.removeClass(unfavoritedIconClass).addClass(favoritedIconClass);
            } else {
                $icon.removeClass(favoritedIconClass).addClass(unfavoritedIconClass);
            }
            $icon.closest(favIconSelector).attr('title', title); // Update tooltip
        }
    }

    /**
     * Iterates through currently visible messages, injects the favorite icon if missing,
     * and updates its state based on stored data.
     */
    function injectOrUpdateFavoriteIcons() {
        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) return; // No active chat

        const chatId = chatInfo.chatId; // Use the unique chat file ID

        $('#chat .mes').each(function() {
            const $messageElement = $(this);
            const $extraButtons = $messageElement.find('.extraMesButtons');
            let $iconContainer = $extraButtons.find(favIconSelector);

            if ($extraButtons.length && $iconContainer.length === 0) {
                $extraButtons.prepend(messageButtonHtml);
                $iconContainer = $extraButtons.find(favIconSelector);
            }

            if ($iconContainer.length > 0) {
                const messageId = $messageElement.attr('mesid'); // Get the message index attribute
                if (messageId !== undefined && messageId !== null) {
                    const isFav = isFavorited(chatId, messageId);
                    updateFavoriteIconState($messageElement, isFav);
                } else {
                    console.warn(logPrefix, "Message element missing mesid attribute:", $messageElement);
                }
            }
        });
    }


    // --- Event Handlers ---

    /**
     * Handles clicking the favorite icon on a message. Uses event delegation.
     * @param {Event} event - The click event object.
     */
    function handleFavoriteToggle(event) {
        const $iconContainer = $(event.target).closest(favIconSelector);
        if (!$iconContainer.length) return;

        const $messageElement = $iconContainer.closest('.mes');
        const messageId = $messageElement.attr('mesid'); // Get message index
        const chatInfo = getCurrentChatInfo(); // Get current chat context

        if (messageId === undefined || messageId === null || !chatInfo) {
            console.error(logPrefix, "Could not get messageId or chatInfo on toggle.");
            toastr.error(t("Error: Could not determine message or chat context."));
            return;
        }

        const chatId = chatInfo.chatId; // Use the correct chat ID key
        const $icon = $iconContainer.find('i');

        const isCurrentlyFavorited = $icon.hasClass(favoritedIconClass);

        updateFavoriteIconState($messageElement, !isCurrentlyFavorited);

        if (!isCurrentlyFavorited) { // It WAS unfavorited, NEW state is favorited
            // Find the message object using the index (messageId)
            const message = getChatMessageById(messageId); // Use our reliable function
            if (message) {
                 // Add message.id = messageId before adding if it's missing (shouldn't be)
                 if (message.id === undefined) message.id = parseInt(messageId, 10);
                addFavorite(chatInfo, message);
            } else {
                console.error(logPrefix, `Could not find message object for ID ${messageId} to favorite.`);
                toastr.error(t("Error: Could not find message data for ID {messageId}. Cannot favorite.", { messageId }));
                updateFavoriteIconState($messageElement, false); // Revert visual state
            }
        } else { // It WAS favorited, NEW state is unfavorited
            removeFavoriteByMessageId(chatId, messageId);
        }
    }

    /**
     * Handles clicking the INPUT button (was sidebar button) to open the popup.
     */
    function openFavoritesPopup() {
        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) {
            toastr.warning(t("Please open a chat first."));
            return;
        }
        // Store the info of the chat for which the popup was opened
        currentPopupOriginalChatInfo = chatInfo;
        const chatId = chatInfo.chatId;
        currentPopupPage = 1;

        if (!favoritesPopup) {
             const popupHtml = `
                <div class="favorites-popup-content">
                    <h4 id="favorites-popup-title">Favorites</h4>
                    <hr>
                    <div id="${popupListContainerId}" class="fav-list-container">
                        <div class="empty-state">${t('Loading...')}</div>
                    </div>
                    <div id="${popupPaginationId}" class="pagination-controls" style="display: none;">
                        <button id="fav-popup-prev" class="menu_button fa-solid fa-arrow-left" title="${t('Previous Page')}"></button>
                        <span id="fav-popup-page-indicator">${t('Page {page} / {totalPages}', { page: 1, totalPages: 1 })}</span>
                        <button id="fav-popup-next" class="menu_button fa-solid fa-arrow-right" title="${t('Next Page')}"></button>
                    </div>
                    <hr>
                    <div class="popup_buttons">
                       <button id="fav-popup-preview" class="menu_button">${t('Preview')}</button> <!-- Add Preview Button -->
                       <button id="fav-popup-clear-invalid" class="menu_button">${t('Clear Invalid')}</button>
                       <button id="fav-popup-close" class="menu_button">${t('Close')}</button>
                    </div>
                </div>
            `;
            // Note: Removed wide:true, large:true for now, adjust if needed
            favoritesPopup = new Popup(popupHtml, POPUP_TYPE.TEXT, '', { okButton: 'none', cancelButton: 'none'});

             // Setup event delegation for popup content
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-pencil`, handleEditNote);
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-trash`, handleDeleteFavoriteFromPopup);
             $(favoritesPopup.dom).on('click', '#fav-popup-prev', () => handlePopupPagination('prev'));
             $(favoritesPopup.dom).on('click', '#fav-popup-next', () => handlePopupPagination('next'));
             $(favoritesPopup.dom).on('click', '#fav-popup-clear-invalid', handleClearInvalidFavorites);
             $(favoritesPopup.dom).on('click', '#fav-popup-preview', handlePreviewClick); // <-- Add handler for preview button
             $(favoritesPopup.dom).on('click', '#fav-popup-close', () => favoritesPopup.hide());
        }

        updateFavoritesPopup(chatId, currentPopupPage);
        favoritesPopup.show();
    }

     /**
     * Renders the content of the favorites popup.
     * @param {string} chatId The chat ID (key) to display favorites for.
     * @param {number} page The page number to display.
     */
    function updateFavoritesPopup(chatId, page = 1) {
        if (!favoritesPopup || !currentPopupOriginalChatInfo) return; // Need original info context

        // Use the stored original chat info
        const originalChatId = currentPopupOriginalChatInfo.chatId;
        if (chatId !== originalChatId) {
            console.warn(logPrefix, "Popup update called with mismatched chatId. Using original:", originalChatId);
            chatId = originalChatId; // Ensure we're always showing for the chat it was opened for
        }

        currentPopupPage = page;
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        const context = getContext(); // Get current context to check if it's the SAME chat
        const isCurrentChat = getCurrentChatId() === chatId; // Is the main UI showing the chat we are viewing favorites for?

        let title = t("Favorites");
        let favItems = [];
        let totalItems = 0;

        if (chatData) {
            title = t(`Favorites for: {chatName} ({count})`, { chatName: chatData.name || `Chat ${chatId}`, count: chatData.count || 0 });
            favItems = [...chatData.items].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // Sort by timestamp
            totalItems = chatData.count || 0;
        } else {
            title = t(`Favorites for: {chatName} (0)`, { chatName: currentPopupOriginalChatInfo.name || `Chat ${chatId}` });
        }

        const $popupContent = $(favoritesPopup.dom).find('.favorites-popup-content');
        $popupContent.find('#favorites-popup-title').text(title);

        const $listContainer = $popupContent.find(`#${popupListContainerId}`);
        const $paginationControls = $popupContent.find(`#${popupPaginationId}`);
        const $pageIndicator = $popupContent.find('#fav-popup-page-indicator');
        const $prevButton = $popupContent.find('#fav-popup-prev');
        const $nextButton = $popupContent.find('#fav-popup-next');
        const $clearInvalidButton = $popupContent.find('#fav-popup-clear-invalid');
        const $previewButton = $popupContent.find('#fav-popup-preview'); // Get preview button

        if (totalItems === 0) {
            $listContainer.html(`<div class="empty-state">${t('No favorites in this chat yet.')}</div>`);
            $paginationControls.hide();
            $clearInvalidButton.prop('disabled', true);
            $previewButton.prop('disabled', true); // Disable preview if no favorites
            return;
        } else {
            $previewButton.prop('disabled', false); // Enable preview if there are favorites
        }

        const totalPages = Math.ceil(totalItems / itemsPerPagePopup);
        page = Math.max(1, Math.min(page, totalPages));
        currentPopupPage = page;

        const startIndex = (page - 1) * itemsPerPagePopup;
        const endIndex = startIndex + itemsPerPagePopup;
        const itemsToShow = favItems.slice(startIndex, endIndex);

        let listHtml = '';
        itemsToShow.forEach(favItem => {
            // Pass isCurrentChat to renderer for accurate preview text status
            listHtml += renderFavoriteItem(favItem, isCurrentChat);
        });

        $listContainer.html(listHtml);

        $pageIndicator.text(t('Page {page} / {totalPages}', { page, totalPages }));
        $prevButton.prop('disabled', page === 1);
        $nextButton.prop('disabled', page === totalPages);
        $paginationControls.show();

        // Enable/disable clear invalid button based on whether the MAIN UI is showing this chat
        $clearInvalidButton.prop('disabled', !isCurrentChat);
        if (!isCurrentChat) {
             $clearInvalidButton.attr('title', t('Switch to this chat to clear invalid favorites.'));
        } else {
             $clearInvalidButton.removeAttr('title');
        }

        $listContainer.scrollTop(0);
    }

    /**
     * Generates HTML for a single favorite item in the popup list.
     * @param {object} favItem The favorite item object from settings.
     * @param {boolean} isCurrentChat Whether the main UI is currently displaying the chat this favorite belongs to.
     * @returns {string} HTML string for the list item.
     */
    function renderFavoriteItem(favItem, isCurrentChat) {
        let previewText = '';
        let previewClass = '';
        let message = null;

        // Only try to get message content if the main UI is showing the correct chat
        if (isCurrentChat) {
             message = getChatMessageById(favItem.messageId);
             if(message) {
                 previewText = (message.mes || '').substring(0, 80);
                 if (message.mes && message.mes.length > 80) previewText += '...';
                 previewText = $('<div>').text(previewText).html(); // Basic escaping
             } else {
                 previewText = `[${t('Message deleted')}]`;
                 previewClass = 'deleted';
             }
        } else {
             previewText = `[${t('Preview requires switching to this chat')}]`;
             previewClass = 'requires-switch';
        }

        const formattedTimestamp = favItem.timestamp ? timestampToMoment(favItem.timestamp).format("YYYY-MM-DD HH:mm:ss") : 'N/A';
        const noteDisplay = favItem.note ? `<div class="fav-note">${t('Note')}: ${$('<div>').text(favItem.note).html()}</div>` : ''; // Escape note

        return `
            <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
              <div class="fav-meta">${$('<div>').text(favItem.sender || 'Unknown').html()} (${favItem.role || '?'}) - ${formattedTimestamp}</div>
              ${noteDisplay}
              <div class="fav-preview ${previewClass}">${previewText}</div>
              <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="${t('Edit Note')}"></i>
                <i class="fa-solid fa-trash" title="${t('Delete Favorite')}"></i>
              </div>
            </div>
        `;
    }

     /** Handles popup pagination clicks */
    function handlePopupPagination(direction) {
        if (!favoritesPopup || !currentPopupOriginalChatInfo) return;

        const chatId = currentPopupOriginalChatInfo.chatId;
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData) return;

        const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);

        if (direction === 'prev' && currentPopupPage > 1) {
            currentPopupPage--;
        } else if (direction === 'next' && currentPopupPage < totalPages) {
            currentPopupPage++;
        }
        updateFavoritesPopup(chatId, currentPopupPage);
    }


    /** Handles click on the Edit Note icon in the popup */
    async function handleEditNote(event) {
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         // Get the chat ID from the stored info when the popup was opened
         const chatId = currentPopupOriginalChatInfo?.chatId;

         if (!chatId || !favId) return;

         const settings = getPluginSettings();
         const chatData = settings.chats[chatId];
         const favItem = chatData?.items.find(item => item.id === favId);

         if (!favItem) {
             console.error(logPrefix, `Favorite item ${favId} not found for editing note.`);
             return;
         }

         try {
             const result = await callGenericPopup(
                 t('Enter note for favorite (Sender: {sender}):', { sender: favItem.sender || 'Unknown' }),
                 POPUP_TYPE.INPUT,
                 favItem.note || '', // Default value is current note
                 { rows: 3 }
             );

             if (result !== null && result !== undefined) { // User confirmed (even if empty string)
                 favItem.note = result.trim();
                 console.log(logPrefix, `Updated note for favorite ${favId} in chat ${chatId}.`);
                 saveSettingsDebounced();
                 // Update just this item's display in the popup
                 const $noteDisplay = $itemElement.find('.fav-note');
                 const escapedNote = $('<div>').text(favItem.note).html();
                  if (favItem.note) {
                      if ($noteDisplay.length) {
                          $noteDisplay.html(`${t('Note')}: ${escapedNote}`).show();
                      } else {
                          $itemElement.find('.fav-meta').after(`<div class="fav-note">${t('Note')}: ${escapedNote}</div>`);
                      }
                  } else {
                      $noteDisplay.hide().empty(); // Hide if note is removed
                  }
                 renderPluginPage(); // Also update plugin page if visible
             }
         } catch (error) {
             console.error(logPrefix, "Error during edit note popup:", error);
             if (error !== POPUP_RESULT.CANCELLED) { // Check specific cancel result
                 toastr.error(t("Error occurred while editing note."));
             }
         }
     }

     /** Handles click on the Delete icon in the popup */
     async function handleDeleteFavoriteFromPopup(event) {
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const messageId = $itemElement.data('msg-id'); // Get message ID for icon update
         const chatId = currentPopupOriginalChatInfo?.chatId;

         if (!chatId || !favId) return;

         try {
             const confirmation = await callGenericPopup(
                 t("Are you sure you want to remove this favorite entry?"),
                 POPUP_TYPE.CONFIRM
             );

             if (confirmation === POPUP_RESULT.AFFIRMATIVE) { // Check specific confirm result
                 const removed = removeFavoriteById(chatId, favId); // This handles saving and popup refresh
                 if (removed) {
                    toastr.success(t('Favorite removed.'));
                     // Update the icon in the main chat interface ONLY if it's the current chat
                     if (getCurrentChatId() === chatId) {
                         const $messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                         if ($messageElement.length) {
                             updateFavoriteIconState($messageElement, false); // Set to unfavorited
                         }
                     }
                 }
             }
         } catch (error) {
             console.error(logPrefix, "Error during delete confirmation:", error);
             if (error !== POPUP_RESULT.CANCELLED) {
                toastr.error(t("An error occurred while trying to delete the favorite."));
             }
         }
     }

     /** Handles click on the 'Clear Invalid' button in the popup */
    async function handleClearInvalidFavorites() {
        const chatId = currentPopupOriginalChatInfo?.chatId;
        // IMPORTANT: This action requires the MAIN UI to be showing the correct chat,
        // because we need to check against its CURRENT context.chat array.
        if (!chatId || getCurrentChatId() !== chatId) {
            toastr.warning(t("Please ensure you are in the correct chat (the one this favorite list belongs to) to clear invalid favorites."));
            return;
        }

        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items || chatData.items.length === 0) {
            toastr.info(t("No favorites to check in this chat."));
            return;
        }

        // Get the CURRENT context of the main UI chat
        const context = getContext();
        // Map current message IDs (indices) to strings for consistent comparison
        const currentMessageIds = new Set(context.chat.map(msg => String(msg.id)));
        const invalidFavIds = [];

        chatData.items.forEach(favItem => {
            // Check if the favorited messageId exists in the current chat array
            if (!currentMessageIds.has(String(favItem.messageId))) {
                invalidFavIds.push(favItem.id);
            }
        });

        if (invalidFavIds.length === 0) {
            toastr.info(t("No invalid favorites found (all corresponding messages still exist)."));
            return;
        }

        try {
            const confirmation = await callGenericPopup(
                t("Found {count} favorite(s) pointing to deleted messages. Remove them?", { count: invalidFavIds.length }),
                POPUP_TYPE.CONFIRM
            );

            if (confirmation === POPUP_RESULT.AFFIRMATIVE) {
                let removedCount = 0;
                invalidFavIds.forEach(favId => {
                    if (removeFavoriteById(chatId, favId)) { // removeFavoriteById handles saving and counts
                        removedCount++;
                    }
                });
                console.log(logPrefix, `Cleared ${removedCount} invalid favorites from chat ${chatId}.`);
                if(removedCount > 0) {
                    toastr.success(t("Removed {count} invalid favorite entries.", { count: removedCount }));
                    // updateFavoritesPopup is called within removeFavoriteById if the popup is still open for this chat
                    // Ensure the final state is rendered if needed (already handled)
                } else {
                     toastr.warning(t("No invalid favorites were removed (operation might have failed)."));
                }
            }
        } catch (error) {
             console.error(logPrefix, "Error during clear invalid confirmation:", error);
             if (error !== POPUP_RESULT.CANCELLED) {
                 toastr.error(t("An error occurred while trying to clear invalid favorites."));
             }
        }
    }


    // --- Preview Feature ---

    /**
     * Handles clicking the Preview button in the popup.
     */
    async function handlePreviewClick() {
        if (!currentPopupOriginalChatInfo) {
            toastr.error(t("Cannot determine the original chat for preview."));
            return;
        }

        const originalChatInfo = currentPopupOriginalChatInfo;
        const originalChatId = originalChatInfo.chatId; // The ID/filename used as key

        // 1. Check prerequisites (generation, saving) in the CURRENT context (which is the original chat)
        if (is_send_press || is_group_generating) {
            toastr.warning(t("Please wait for generation to complete before previewing."));
            return;
        }
        if (isChatSaving) {
            toastr.warning(t("Please wait for chat saving to complete before previewing."));
            return;
        }

        // Close the popup before starting potentially disruptive actions like switching chat
        if (favoritesPopup && favoritesPopup.isShown()) {
            favoritesPopup.hide();
        }
        // Optional: Show a loader?
        // showLoader();

        try {
            // 2. Get favorite items from settings for the original chat
            const settings = getPluginSettings();
            const chatData = settings.chats[originalChatId];
            if (!chatData || !chatData.items || chatData.items.length === 0) {
                toastr.info(t("No favorites to preview in this chat."));
                // hideLoader();
                return;
            }
            const favoriteItems = chatData.items;

            // 3. Get FULL message objects from the ORIGINAL chat context
            // Ensure we are still in the original context or use the correct `chat` array snapshot
            const context = getContext(); // Get context again to be sure
            if (context.chatId !== originalChatId) {
                // This shouldn't happen if popup was opened correctly, but good safety check
                 toastr.error(t("Context mismatch. Cannot reliably get original messages for preview."));
                 console.error(logPrefix, "Context switched before message collection for preview.");
                 // hideLoader();
                 return;
            }
            const originalMessages = [...context.chat]; // Use the current chat array from context
            const fullMessagesToPreview = [];

            favoriteItems.forEach(favItem => {
                const messageId = favItem.messageId;
                // Find the message using its ID (index) in the original chat array snapshot
                const fullMessage = originalMessages[parseInt(messageId, 10)]; // Access by index
                if (fullMessage) {
                    // Add a deep copy to avoid modifying original messages later
                    const messageCopy = JSON.parse(JSON.stringify(fullMessage));
                    // Ensure it has the ID for addOneMessage forceId
                    if (messageCopy.id === undefined) messageCopy.id = parseInt(messageId, 10);
                    fullMessagesToPreview.push(messageCopy);
                } else {
                    console.warn(logPrefix, `Original message with ID ${messageId} not found for preview.`);
                }
            });

            if (fullMessagesToPreview.length === 0) {
                toastr.info(t("Could not find any corresponding messages for the favorites to preview."));
                // hideLoader();
                return;
            }

             // Sort messages chronologically based on timestamp or ID (index)
             fullMessagesToPreview.sort((a, b) => (a.id || 0) - (b.id || 0));


            // 4. Find or Create Preview Chat ID
            let previewChatId = settings.previewChats[originalChatId];
            let isNewPreviewChat = false;

            if (!previewChatId) {
                console.log(logPrefix, `No existing preview chat found for ${originalChatId}. Creating new one.`);
                isNewPreviewChat = true;
                // Create new chat (will switch context automatically)
                await doNewChat({ deleteCurrentChat: false });
                // Wait for context switch and new chat load
                await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay

                // Get the new context and ID
                const newContext = getContext();
                previewChatId = newContext.chatId; // Get the ID of the newly created chat

                // Rename the new chat
                console.log(logPrefix, `Renaming new chat ${previewChatId} to ${previewChatName}`);
                await renameChat(previewChatName); // Call rename in the NEW context
                await new Promise(resolve => setTimeout(resolve, 300)); // Delay after rename

                // Store the association
                settings.previewChats[originalChatId] = previewChatId;
                saveSettingsDebounced();
                console.log(logPrefix, `Associated original chat ${originalChatId} with preview chat ${previewChatId}`);
            } else {
                console.log(logPrefix, `Found existing preview chat ${previewChatId} for ${originalChatId}. Switching.`);
                // Switch to existing preview chat
                if (originalChatInfo.type === 'group') {
                    await openGroupChat(originalChatInfo.groupId, previewChatId); // Assuming openGroupChat takes specific chat ID
                } else {
                    // openCharacterChat needs the CHARACTER's avatar filename, not the chat filename.
                    // We need to get the character data.
                    const character = context.characters?.find(c => c.id === originalChatInfo.characterId);
                    if (!character) {
                        throw new Error(`Could not find character data for ID ${originalChatInfo.characterId}`);
                    }
                    // Assuming the first part of chatFileName is the character file base name
                    // This might be fragile. Let's try just using openCharacterChat(previewChatId) if it works that way?
                    // Testing indicates openCharacterChat(file_name) expects the specific chat file name.
                    await openCharacterChat(previewChatId); // Use the specific chat filename
                }
                // Wait for switch
                await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay
            }

            // 5. We are now in the Preview Chat Context
            console.log(logPrefix, `Now in preview chat ${previewChatId}. Clearing and populating.`);
            const previewContext = getContext(); // Get context of the preview chat

            // Safety check
            if (previewContext.chatId !== previewChatId) {
                 console.error(logPrefix, "Context switch to preview chat failed or incorrect ID!");
                  toastr.error(t("Failed to switch to preview chat correctly."));
                 // hideLoader();
                 return;
            }

            // 6. Clear Chat
            clearChat();
            await new Promise(resolve => setTimeout(resolve, 300)); // Wait for clear

            // 7. Populate Chat (Respecting Truncation)
            const truncationSetting = power_user?.chat_truncation; // Access global power_user settings
            let messagesToDisplay = fullMessagesToPreview;
            if (truncationSetting && truncationSetting > 0 && fullMessagesToPreview.length > truncationSetting) {
                console.log(logPrefix, `Truncating preview to last ${truncationSetting} messages.`);
                messagesToDisplay = fullMessagesToPreview.slice(-truncationSetting);
                // Optionally add a system message indicating truncation?
                // await previewContext.addOneMessage({ is_system: true, name: 'System', mes: `Preview truncated to the last ${truncationSetting} favorited messages.` }, { scroll: false });
            }

            console.log(logPrefix, `Populating preview with ${messagesToDisplay.length} messages.`);
            for (const message of messagesToDisplay) {
                // Ensure addOneMessage exists on the context (it should)
                if (typeof previewContext.addOneMessage === 'function') {
                     // Use forceId to try and keep original message index if possible
                     await previewContext.addOneMessage(message, { scroll: true, forceId: message.id });
                     await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between messages
                } else {
                     console.error(logPrefix, "addOneMessage function not found on preview context!");
                     break; // Stop populating if function missing
                }
            }

            // 8. Optional: Disable Interaction in Preview Chat
            // Example: Add a class to body or #chat when in preview mode
            // $('body').addClass('in-preview-mode'); // Need corresponding CSS to disable inputs/buttons
             console.log(logPrefix, "Preview population complete.");
             toastr.success(t("Preview chat loaded with favorites."));

        } catch (error) {
            console.error(logPrefix, "Error during preview process:", error);
            toastr.error(t("An error occurred while preparing the preview chat."));
        } finally {
             // hideLoader();
             // Ensure preview mode class is removed if switching away (handle in CHAT_CHANGED event?)
            // $('body').removeClass('in-preview-mode');
        }
    }


    // --- Plugin Page (Settings Overview) Functions ---

    /** Renders the plugin's settings page content (overview of all favorites). */
    function renderPluginPage(page = 1) {
        const $settingsArea = $(`#${settingsContainerId}`);
        if (!$settingsArea.length) return;

        const settings = getPluginSettings();
        const allFavChats = settings.chats || {};
        const chatIds = Object.keys(allFavChats);

        // Filter out chats with 0 favorites for the main list display? Optional.
        // const validChatIds = chatIds.filter(id => allFavChats[id]?.count > 0);

        if (chatIds.length === 0) { // Changed to check allFavChats keys
            $settingsArea.html(`<div class="empty-state">${t('No favorites found across any chats yet.')}</div>`);
            return;
        }

        // Grouping and Sorting (similar to before, adjust if needed)
        const groupedChats = {};
        const context = getContext(); // For getting current names

        chatIds.forEach(chatId => {
            const chatData = allFavChats[chatId];
            if (!chatData || chatData.count === 0) return; // Skip empty chats in overview

            let groupKey = t("Unknown / Other");
            let displayName = chatData.name || `Chat ${chatId}`;

            try { // Add try-catch for safety accessing context data
                if (chatData.type === "private" && chatData.characterId !== undefined) {
                    const character = context.characters?.find(c => c.id === chatData.characterId);
                    groupKey = character ? character.name : displayName;
                } else if (chatData.type === "group" && chatData.groupId !== undefined) {
                    const group = context.groups?.find(g => g.id === chatData.groupId);
                    groupKey = group ? group.name : displayName;
                }
            } catch (err) {
                console.warn(logPrefix, "Error accessing context data during grouping:", err);
            }


            if (!groupedChats[groupKey]) {
                groupedChats[groupKey] = [];
            }
            groupedChats[groupKey].push({
                chatId: chatId, // Store the key used in settings
                displayName: displayName,
                count: chatData.count || 0,
            });
        });

        const sortedGroupKeys = Object.keys(groupedChats).sort((a, b) => a.localeCompare(b));

        let allEntries = [];
        sortedGroupKeys.forEach(groupKey => {
             allEntries.push({ isGroupTitle: true, title: groupKey });
            const sortedChats = groupedChats[groupKey].sort((a, b) => a.displayName.localeCompare(b.displayName));
             allEntries = allEntries.concat(sortedChats);
        });


        const totalEntries = allEntries.length;
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
                // Escape display name for title attribute and content
                const escapedDisplayName = $('<div>').text(entry.displayName).html();
                contentHtml += `
                    <div class="chat-entry-item" data-chat-id="${entry.chatId}" title="${t('Click to view favorites for {chatName}', { chatName: escapedDisplayName })}">
                        <span>${escapedDisplayName}</span>
                        <span class="count">(${entry.count})</span>
                    </div>`;
            }
        });
        contentHtml += `</div>`;

        if (totalPages > 1) {
            contentHtml += `
                <div id="${pluginPagePaginationId}" class="pagination-controls">
                    <button id="fav-plugin-prev" class="menu_button fa-solid fa-arrow-left" title="${t('Previous Page')}" ${page === 1 ? 'disabled' : ''}></button>
                    <span id="fav-plugin-page-indicator">${t('Page {page} / {totalPages}', { page, totalPages })}</span>
                    <button id="fav-plugin-next" class="menu_button fa-solid fa-arrow-right" title="${t('Next Page')}" ${page === totalPages ? 'disabled' : ''}></button>
                </div>`;
        }

        $settingsArea.html(contentHtml);
        setupPluginPageEventDelegation(); // Re-run setup
    }

     /** Handles plugin page pagination clicks */
     function handlePluginPagePagination(direction) {
         const settings = getPluginSettings();
         const allFavChats = settings.chats || {};
         // Recalculate total pages based on actual displayed items (non-empty, grouped)
         let entryCountForPaging = 0;
         const groupedChats = {};
          Object.keys(allFavChats).forEach(chatId => {
              const chatData = allFavChats[chatId];
              if (!chatData || chatData.count === 0) return; // Skip empty

              let groupKey = t("Unknown / Other");
               if (chatData.type === "private" && chatData.characterId !== undefined) groupKey = chatData.name || `Char ${chatData.characterId}`;
               else if (chatData.type === "group" && chatData.groupId !== undefined) groupKey = chatData.name || `Group ${chatData.groupId}`;

              if (!groupedChats[groupKey]) {
                  groupedChats[groupKey] = true;
                  entryCountForPaging++; // Count group title
              }
              entryCountForPaging++; // Count chat entry
          });

         const totalPages = Math.ceil(entryCountForPaging / itemsPerPagePluginPage);
         if (totalPages <= 0) return; // No pages

         if (direction === 'prev' && currentPluginPagePage > 1) {
             currentPluginPagePage--;
         } else if (direction === 'next' && currentPluginPagePage < totalPages) {
             currentPluginPagePage++;
         }
         renderPluginPage(currentPluginPagePage);
     }


    /** Handles clicks on chat entries within the plugin settings page */
    function handlePluginPageChatClick(event) {
        const $chatEntry = $(event.target).closest('.chat-entry-item');
        if (!$chatEntry.length) return;

        const clickedChatId = $chatEntry.data('chat-id'); // This is the original chat ID (key)
        if (clickedChatId) {
             console.log(logPrefix, `Opening favorites popup for chat ${clickedChatId} from plugin page.`);
             // Need to simulate opening the popup AS IF we were in that chat
             // Find the necessary info (name, type, ids) from settings if possible
             const settings = getPluginSettings();
             const chatData = settings.chats[clickedChatId];
             if (!chatData) {
                 toastr.error(t("Could not find data for the selected chat."));
                 return;
             }
             // Construct a fake chatInfo object for the popup
             const fakeChatInfo = {
                 chatId: clickedChatId,
                 type: chatData.type,
                 name: chatData.name,
                 characterId: chatData.characterId,
                 groupId: chatData.groupId,
                 chatFileName: clickedChatId // Assuming chatId IS the filename/key needed
             };
             currentPopupOriginalChatInfo = fakeChatInfo; // Set the context for the popup
             currentPopupPage = 1;

             if(!favoritesPopup) {
                 openFavoritesPopup(); // Will create the popup
             } else {
                updateFavoritesPopup(clickedChatId, currentPopupPage); // Update existing popup
                favoritesPopup.show();
             }
        }
    }

    /** Sets up event delegation for the plugin page list and pagination */
    function setupPluginPageEventDelegation() {
        const $settingsArea = $(`#${settingsContainerId}`);
        $settingsArea.off('click', '.chat-entry-item');
        $settingsArea.off('click', '#fav-plugin-prev');
        $settingsArea.off('click', '#fav-plugin-next');

        $settingsArea.on('click', '.chat-entry-item', handlePluginPageChatClick);
        $settingsArea.on('click', '#fav-plugin-prev', () => handlePluginPagePagination('prev'));
        $settingsArea.on('click', '#fav-plugin-next', () => handlePluginPagePagination('next'));
    }


    // --- Plugin Initialization ---
    jQuery(async () => {
        console.log(logPrefix, "Loading...");
        initializeSettings();

        // 1. Inject Settings UI Stub (into Extensions page)
        // We only need the container div, the content is rendered dynamically by renderPluginPage
        try {
            // Assuming settings_display.html just contains the drawer structure
            // and an empty div like <div id="favorites-plugin-settings-area"></div> inside the content area.
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'settings_display');
             let $container = $('#extensions_settings');
             if (!$container.length) $container = $('#settings_tabs_content'); // Another common container
             if (!$container.length) $container = $('#translation_container'); // Fallback
             if($container.length) {
                $container.append(settingsHtml);
                 // Make sure the target container exists within the loaded HTML:
                 if ($(`#${settingsContainerId}`).length === 0) {
                      // If settings_display.html doesn't have the container, inject it into the drawer content
                      $container.find('.inline-drawer-content').last().append(`<div id="${settingsContainerId}"></div>`);
                 }
                console.log(logPrefix, `Added settings UI container.`);
                renderPluginPage(currentPluginPagePage); // Initial render of the overview list
                setupPluginPageEventDelegation(); // Setup clicks for the list
             } else {
                 console.error(logPrefix, "Could not find container for settings UI.");
             }
        } catch (error) {
            console.error(logPrefix, "Failed to load or inject settings_display.html:", error);
        }

        // 2. Inject Input Button
        try {
            // Use the correct template name: input_button.html
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'input_button');
            // Inject it near the send button or other input-related controls
            // Example: $('#send_form').append(inputButtonHtml); // Adjust selector as needed
            // Or use a known container like the sidebar example if preferred:
            $('#extensions_buttons_container').append(inputButtonHtml); // A common place for extension buttons near input
            console.log(logPrefix, "Added input button.");

            // Add direct click listener for the input button
            $(document).on('click', `#${sidebarButtonId}`, openFavoritesPopup);

        } catch (error) {
            console.error(logPrefix, "Failed to load or inject input_button.html:", error);
        }

        // 3. Setup Message Button Injection & Event Delegation
        injectOrUpdateFavoriteIcons(); // Initial injection
        $(document).on('click', favIconSelector, handleFavoriteToggle); // Use event delegation
        console.log(logPrefix, `Set up event delegation for ${favIconSelector}`);


        // 4. Listen for SillyTavern events to keep UI updated
        // CHAT_UPDATED is generic, might be too frequent. MESSAGE_SENT, MESSAGE_RECEIVED, MESSAGE_EDITED, MESSAGE_DELETED might be better.
        // Using CHAT_UPDATED for now as it was in the original.
        eventSource.on(event_types.CHAT_UPDATED, injectOrUpdateFavoriteIcons);
        eventSource.on(event_types.MESSAGE_SWIPED, injectOrUpdateFavoriteIcons); // After swipe
        // When chat is changed (switched character/group/chat file)
        eventSource.on(event_types.CHAT_CHANGED, () => {
            injectOrUpdateFavoriteIcons();
            // Reset popup state if chat changes?
             if (favoritesPopup && favoritesPopup.isShown()) {
                 // Maybe close it, or update it if it should reflect the new chat?
                 // For now, let's just rely on injectOrUpdateFavoriteIcons
             }
             // Check if we entered/left preview mode
             // Example: Check if current chat name is previewChatName
             // const context = getContext();
             // if (context.chatMetadata?.title === previewChatName) {
             //     $('body').addClass('in-preview-mode');
             // } else {
             //     $('body').removeClass('in-preview-mode');
             // }
        });
        // Message rendered events
        eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
            const $message = $(`#chat .mes[mesid="${messageId}"]`);
            if ($message.length) injectOrUpdateFavoriteIcons(); // More targeted update
        });
         eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            const $message = $(`#chat .mes[mesid="${messageId}"]`);
            if ($message.length) injectOrUpdateFavoriteIcons(); // More targeted update
        });

        // Update overview when settings change (e.g., after import/manual edit)
         eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, () => {
             initializeSettings(); // Re-initialize on load
             renderPluginPage();
         });
         // Debounced save might trigger SETTINGS_UPDATED too late, but useful for external changes
         // eventSource.on(event_types.SETTINGS_UPDATED, () => {
         //     renderPluginPage();
         //     injectOrUpdateFavoriteIcons(); // Check icons too
         // });

        console.log(logPrefix, "Loaded successfully.");
    });

})(); // End IIFE
