from helpers import parse


class Service:
    def run(self):
        return parse("ok")


def build_service(value):
    return Service()
