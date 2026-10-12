# Word list sources

The expanded English word data is derived from the `large_en.msgpack.gz`
frequency data in [wordfreq](https://github.com/rspeer/wordfreq), pinned to
commit [`ec48c0a`](https://github.com/rspeer/wordfreq/commit/ec48c0a1237f271b343fa4e38fb896c8da587804).
The snapshot reflects language usage through about 2021.

Wordfreq's data is available under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
The author is Robyn Speer. Wordfreq attributes its data to Google Books
Ngrams, the Leeds Internet Corpus, Wikipedia, ParaCrawl, OpenSubtitles, and
SUBTLEX. See the upstream
[NOTICE](https://github.com/rspeer/wordfreq/blob/ec48c0a1237f271b343fa4e38fb896c8da587804/NOTICE.md)
for full attribution details.

The word lists here were modified by filtering to lowercase five-letter
alphabetic tokens. `valid-guesses.txt` combines those tokens with the existing
guess list. `answers.txt` retains the existing answers and adds frequent words
(frequency bin index at most 600, corresponding to at least one occurrence per
million tokens) that were already in the existing guess list. The additions
derived from wordfreq are subject to CC BY-SA 4.0; the pre-existing entries
remain subject to their original terms.

`uncap` and `yodel` are also included as possible answers; both were missing
from the frequency-filtered answer list despite being present in the
valid-guess list.

These expanded English lists are not the official NYT Wordle answer or guess
lists, and they may contain words NYT does not use.
