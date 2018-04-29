# marvel

Ok, so my family just recently took my son out on his birthday to see Black Panther. As with any Marvel film in the last decade you have to shoot dirty looks to your wife and daughter as they get up to leave when the credits roll. They should have learned by now that there will be at least one if not several mid and after credit scenes.

So my son and I were waiting through the infinite amount of names scrolling down the screen, both women in my family deciding that peeing was more important than another 30 seconds of the movie. Amateurs. And a thought occurred to me. I wonder who is ultimately responsible for all of these marvel films? I hope it’s some random guy named Steve who works in visual effects.
So idea in hand and fresh from the knowledge of who Wakanda is hiding from the world I got stuck in.

### Step One: 
Get a list of marvel films, one stop on a wiki page was all I needed

### Step Two: 
Build a web scraper for IMDB and with the help of IMDBPY this was fairly straight forward. It lives at: [https://github.com/alberanid/imdbpy](https://github.com/alberanid/imdbpy). There was a slight hiccup in that this library seems to use this weird key alias dictionary to translate when IMDB pages don’t use standardized terms. Unfortunately those can overlap and sometimes just be plain wrong. I’ve made a small patch, but it hasn’t been merged yet, so I’ve the file is here as well.

### Step Three: 
Be proud of my little web scraper. Check

### Step Four: 
Take the data and upload into a SQL database because I have grand ideas of leveraging d3.js and making slick visualisations.

### Step Five: 
Realize I’m too lazy to make slick visualisations.

### Step Six: 
Write a few SQL statements to get some neato facts out of the data 

### Step Seven: 
Share all of this with all of you so that I can hopefully get someone else to carry one with building some sweet visualisations.

So the data is all here, all the code I’ve used is sitting here so have at. Although if you have a crack at it, send me a message, I’d love to see your work.
