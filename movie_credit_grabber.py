
from imdb import IMDb
import csv

# create an instance of the IMDb class
ia = IMDb()

# list of movie IDs
movies = ['0036697','0091225','0098141','0103923','0109770','0120611','0120903','0187738','0145487','0287978','0290334','0286716','0330793','0316654','0359013','0357277','0120667','0376994','0259324','0413300','0486576','0371746','0800080','0450314','0458525','1228705','0800369','1270798','0458339','1071875','0848228','0948470','1300854','1430132','1981115','1843866','1872181','1877832','2015381','2395427','0478970','1502712','1431045','3498820','3385516','1211837','3315342','3896198','2250912','3501632','1825683', '4154756']

# create a csv file for this movie data
with open('marvel_data.csv', 'w', newline='') as csvfile:
	filewriter = csv.writer(csvfile, delimiter=',', quotechar='|', quoting=csv.QUOTE_MINIMAL)
	filewriter.writerow(['Year', 'Title', 'Type', 'Name', 'URL'])

	# cycle through each movie
	for each in movies:

		# get a movie from its IMDb code
		movie = ia.get_movie(each)

		# build a list of the available details
		details = movie.infoset2keys

		# go through the list of details
		for detail in details['main']:
			# I already know I don't want a few of these
			if detail not in ['genres', 'runtimes', 'countries', 'country codes', 'language codes', 'color info', 'aspect ratio', 'sound mix', 'certificates', 'original air date', 'rating', 'votes', 'cover url', 'plot outline', 'languages', 'kind', 'writer', 'director', 'akas','title', 'year', 'top 250 rank']:
				
				# get the number of names in a detail and print those mothers on the screen
				try:
					length = len(movie[detail])
					for number in range(0, length):	
						if movie[detail][number].personID != None:
							try:
								filewriter.writerow([movie['year'], movie['title'], detail, movie[detail][number], 'https://www.imdb.com/name/nm%s' % movie[detail][number].personID])
							except UnicodeEncodeError:
								filewriter.writerow([detail, ' - UnicodeEncodeError'])
				# some of these just don't return values and technically they have them or at least they do on the website so I mark them with 'KeyError' and go and get them from the website
				# it'd be cool if someone wanted to figure out why
				except KeyError:
					filewriter.writerow([detail, ' - KeyError'])
				except TypeError:
					filewriter.writerow([detail, ' - TypeError'])
