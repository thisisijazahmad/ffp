// Function to capitalize words while excluding specific ones
// in a list of topic tags
function capitalizeListItem(text) {
    const excludeWords = ['a', 'and'];

    // \b: A word boundary. This ensures that the match is a whole word and not part of a larger word.
    // (\w+): A capturing group that matches one or more word characters (a-z, A-Z, 0-9, _). This captures the entire word.
    // /g: The global flag, which tells replace() to find and replace all matches in the string, not just the first one.

    return text.replace(/\b(\w+)\b/g, (match, word) => {
        // Convert the word to lowercase for the check
        const lowerCaseWord = word.toLowerCase();

        // Capitalize only if the word is NOT in the exclude list
        if (excludeWords.includes(lowerCaseWord)) {
            return lowerCaseWord;
        } else {
            // Capitalize the first letter and make the rest lowercase
            return lowerCaseWord.charAt(0).toUpperCase() + lowerCaseWord.slice(1);
        }
    });
}

// Select all list items on the page
document.querySelectorAll('span.tag').forEach(li => {
    li.textContent = capitalizeListItem(li.textContent);
});